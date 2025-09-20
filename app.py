from flask import Flask, request, jsonify, send_from_directory, render_template_string
from flask_cors import CORS
import os
import json
import re
from urllib.parse import urlparse, parse_qs
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api.formatters import SRTFormatter, TextFormatter, WebVTTFormatter
import logging

# Configuration logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

# Configuration
YOUTUBE_API_KEY = os.environ.get('YOUTUBE_API_KEY', '')

def extract_video_id(url):
    """Extrait l'ID de la vidéo YouTube depuis différents formats d'URL"""
    patterns = [
        r'(?:v=|\/)([0-9A-Za-z_-]{11}).*',
        r'(?:embed\/)([0-9A-Za-z_-]{11})',
        r'(?:watch\?v=)([0-9A-Za-z_-]{11})',
        r'(?:youtu\.be\/)([0-9A-Za-z_-]{11})',
    ]
    
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return None

@app.route('/')
def index():
    """Page d'accueil avec l'interface utilisateur"""
    with open('static/index.html', 'r', encoding='utf-8') as f:
        return f.read()

@app.route('/static/<path:filename>')
def serve_static(filename):
    """Servir les fichiers statiques"""
    return send_from_directory('static', filename)

@app.route('/privacy_policy.html')
def privacy_policy():
    """Page de politique de confidentialité"""
    with open('static/privacy_policy.html', 'r', encoding='utf-8') as f:
        return f.read()

@app.route('/manifest.json')
def manifest():
    """Manifeste PWA"""
    with open('static/manifest.json', 'r', encoding='utf-8') as f:
        return f.read(), 200, {'Content-Type': 'application/json'}

@app.route('/service-worker.js')
def service_worker():
    """Service worker"""
    with open('static/service-worker.js', 'r', encoding='utf-8') as f:
        return f.read(), 200, {'Content-Type': 'application/javascript'}

@app.route('/api/test', methods=['GET'])
def test_api():
    """Test de l'API et vérification de la clé YouTube"""
    return jsonify({
        'status': 'OK',
        'hasYouTubeKey': bool(YOUTUBE_API_KEY),
        'keyLength': len(YOUTUBE_API_KEY) if YOUTUBE_API_KEY else 0,
        'transcriptApiAvailable': True
    })

@app.route('/api/subtitles', methods=['POST', 'OPTIONS'])
def get_subtitles():
    """Récupération des sous-titres avec youtube-transcript-api"""
    
    # Gestion CORS preflight
    if request.method == 'OPTIONS':
        return '', 200

    try:
        data = request.get_json()
        
        if not data or 'videoId' not in data:
            return jsonify({'error': 'videoId requis'}), 400
            
        video_id = data['videoId']
        format_type = data.get('format', 'srt')
        language = data.get('language', 'fr')
        
        logger.info(f"Récupération sous-titres pour vidéo: {video_id}, format: {format_type}, langue: {language}")
        
        # Tentative de récupération des sous-titres
        try:
            # Essayer d'abord la langue demandée
            transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)
            
            # Chercher la langue demandée
            transcript = None
            try:
                transcript = transcript_list.find_transcript([language])
                actual_language = language
            except:
                # Si la langue demandée n'existe pas, essayer l'anglais
                try:
                    transcript = transcript_list.find_transcript(['en'])
                    actual_language = 'en'
                except:
                    # Prendre la première disponible
                    available_transcripts = list(transcript_list)
                    if available_transcripts:
                        transcript = available_transcripts[0]
                        actual_language = available_transcripts[0].language_code
                    else:
                        return jsonify({'error': 'Aucun sous-titre disponible pour cette vidéo'}), 404
            
            # Récupérer le contenu
            transcript_data = transcript.fetch()
            
            # Formater selon le type demandé
            if format_type == 'srt':
                formatter = SRTFormatter()
                content = formatter.format_transcript(transcript_data)
            elif format_type == 'vtt':
                formatter = WebVTTFormatter()
                content = formatter.format_transcript(transcript_data)
            elif format_type == 'txt':
                formatter = TextFormatter()
                content = formatter.format_transcript(transcript_data)
            elif format_type == 'json':
                content = json.dumps(transcript_data, ensure_ascii=False, indent=2)
            else:
                # Format brut par défaut
                content = '\n'.join([f"{entry['start']:.2f}s: {entry['text']}" for entry in transcript_data])
            
            # Informations sur les langues disponibles
            available_languages = []
            try:
                for t in transcript_list:
                    available_languages.append({
                        'language': t.language_code,
                        'name': t.language,
                        'is_generated': t.is_generated
                    })
            except:
                available_languages = [{'language': actual_language, 'name': actual_language, 'is_generated': False}]
            
            response_data = {
                'videoId': video_id,
                'language': actual_language,
                'format': format_type,
                'content': content,
                'availableLanguages': available_languages,
                'success': True
            }
            
            if format_type == 'json':
                return jsonify(response_data)
            else:
                return content, 200, {
                    'Content-Type': 'text/plain; charset=utf-8',
                    'Content-Disposition': f'attachment; filename="{video_id}_subtitles.{format_type}"'
                }
                
        except Exception as transcript_error:
            logger.error(f"Erreur transcript API: {str(transcript_error)}")
            
            # Messages d'erreur plus spécifiques
            error_message = str(transcript_error)
            if 'No transcripts were found' in error_message:
                return jsonify({
                    'error': 'Aucun sous-titre disponible pour cette vidéo',
                    'details': 'Cette vidéo ne possède pas de sous-titres automatiques ou manuels'
                }), 404
            elif 'Transcript is disabled' in error_message:
                return jsonify({
                    'error': 'Les sous-titres sont désactivés pour cette vidéo',
                    'details': 'Le créateur a désactivé les sous-titres'
                }), 403
            elif 'Video unavailable' in error_message:
                return jsonify({
                    'error': 'Vidéo non disponible',
                    'details': 'La vidéo est privée, supprimée ou inexistante'
                }), 404
            else:
                return jsonify({
                    'error': 'Erreur lors de la récupération des sous-titres',
                    'details': error_message
                }), 500
                
    except Exception as e:
        logger.error(f"Erreur générale API subtitles: {str(e)}")
        return jsonify({
            'error': 'Erreur interne du serveur',
            'details': str(e)
        }), 500

@app.route('/api/video-info', methods=['POST'])
def get_video_info():
    """Récupération des informations de base d'une vidéo (sans API YouTube)"""
    try:
        data = request.get_json()
        
        if not data or 'url' not in data:
            return jsonify({'error': 'URL requise'}), 400
            
        url = data['url']
        video_id = extract_video_id(url)
        
        if not video_id:
            return jsonify({'error': 'URL YouTube invalide'}), 400
            
        # Informations de base sans API
        video_info = {
            'videoId': video_id,
            'title': f'Vidéo YouTube {video_id}',
            'description': 'Métadonnées complètes disponibles avec une clé API YouTube',
            'thumbnails': {
                'maxresdefault': f'https://img.youtube.com/vi/{video_id}/maxresdefault.jpg',
                'hqdefault': f'https://img.youtube.com/vi/{video_id}/hqdefault.jpg',
                'mqdefault': f'https://img.youtube.com/vi/{video_id}/mqdefault.jpg',
                'default': f'https://img.youtube.com/vi/{video_id}/default.jpg'
            },
            'url': f'https://www.youtube.com/watch?v={video_id}'
        }
        
        # Si on a une clé API, on pourrait récupérer plus d'infos ici
        if YOUTUBE_API_KEY:
            try:
                import urllib.request
                import urllib.parse
                
                api_url = f"https://www.googleapis.com/youtube/v3/videos?id={video_id}&part=snippet,statistics&key={YOUTUBE_API_KEY}"
                
                with urllib.request.urlopen(api_url) as response:
                    api_data = json.loads(response.read().decode())
                    
                if api_data.get('items'):
                    item = api_data['items'][0]
                    snippet = item.get('snippet', {})
                    
                    video_info.update({
                        'title': snippet.get('title', video_info['title']),
                        'description': snippet.get('description', video_info['description']),
                        'tags': snippet.get('tags', []),
                        'channelTitle': snippet.get('channelTitle', ''),
                        'publishedAt': snippet.get('publishedAt', ''),
                        'statistics': item.get('statistics', {})
                    })
                    
            except Exception as api_error:
                logger.warning(f"Erreur API YouTube (non critique): {str(api_error)}")
        
        return jsonify(video_info)
        
    except Exception as e:
        logger.error(f"Erreur video-info: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Endpoint non trouvé'}), 404

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Erreur interne du serveur'}), 500

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    debug = os.environ.get('FLASK_ENV') == 'development'
    
    logger.info(f"Démarrage du serveur sur le port {port}")
    logger.info(f"Mode debug: {debug}")
    logger.info(f"Clé YouTube API configurée: {'Oui' if YOUTUBE_API_KEY else 'Non'}")
    
    app.run(host='0.0.0.0', port=port, debug=debug)