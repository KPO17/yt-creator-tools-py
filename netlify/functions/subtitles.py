import json
import re
import urllib.request
import urllib.parse
from urllib.error import URLError, HTTPError


def handler(event, context):
    """Point d'entrée principal pour Netlify Functions"""
    
    # Headers CORS
    cors_headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json'
    }
    
    # Gérer OPTIONS (preflight CORS)
    if event.get('httpMethod') == 'OPTIONS':
        return {
            'statusCode': 200,
            'headers': cors_headers,
            'body': ''
        }
    
    # Vérifier méthode POST
    if event.get('httpMethod') != 'POST':
        return {
            'statusCode': 405,
            'headers': cors_headers,
            'body': json.dumps({'error': 'Méthode non autorisée'})
        }
    
    try:
        # Parser le body
        if not event.get('body'):
            return error_response(cors_headers, 400, 'Corps de requête manquant')
        
        body = json.loads(event['body'])
        video_id = body.get('videoId', '').strip()
        format_type = body.get('format', 'txt').lower()
        language = body.get('language', 'fr')
        
        # Validation
        if not video_id:
            return error_response(cors_headers, 400, 'ID vidéo manquant')
        
        if not re.match(r'^[a-zA-Z0-9_-]{11}$', video_id):
            return error_response(cors_headers, 400, 'ID vidéo invalide')
        
        print(f"Traitement vidéo {video_id}, format {format_type}, langue {language}")
        
        # Extraire sous-titres
        subtitles = extract_subtitles(video_id, language)
        
        if not subtitles:
            return error_response(cors_headers, 404, 'Aucun sous-titre trouvé pour cette vidéo')
        
        # Formater
        formatted = format_output(subtitles, format_type)
        
        # Headers selon format
        content_type = {
            'txt': 'text/plain; charset=utf-8',
            'srt': 'application/x-subrip; charset=utf-8', 
            'vtt': 'text/vtt; charset=utf-8',
            'json': 'application/json; charset=utf-8'
        }.get(format_type, 'text/plain; charset=utf-8')
        
        final_headers = {**cors_headers, 'Content-Type': content_type}
        
        return {
            'statusCode': 200,
            'headers': final_headers,
            'body': formatted
        }
        
    except json.JSONDecodeError:
        return error_response(cors_headers, 400, 'JSON invalide')
    except Exception as e:
        print(f"Erreur: {str(e)}")
        return error_response(cors_headers, 500, f'Erreur serveur: {str(e)}')


def error_response(headers, status, message):
    """Créer une réponse d'erreur"""
    return {
        'statusCode': status,
        'headers': headers,
        'body': json.dumps({'error': message})
    }


def extract_subtitles(video_id, language):
    """Extraire les sous-titres YouTube"""
    try:
        url = f'https://www.youtube.com/watch?v={video_id}'
        
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
        }
        
        req = urllib.request.Request(url, headers=headers)
        
        with urllib.request.urlopen(req, timeout=30) as response:
            html = response.read().decode('utf-8', errors='ignore')
        
        print(f"Page récupérée: {len(html)} caractères")
        
        # Chercher les pistes de sous-titres avec plusieurs patterns
        patterns = [
            r'"captionTracks":\s*(\[[^\]]+\])',
            r'"captions":\s*\{[^}]*"captionTracks":\s*(\[[^\]]+\])',
            r'"playerCaptionsTracklistRenderer":\s*\{[^}]*"captionTracks":\s*(\[[^\]]+\])'
        ]
        
        tracks = None
        for pattern in patterns:
            match = re.search(pattern, html)
            if match:
                try:
                    tracks = json.loads(match.group(1))
                    print(f"Pistes trouvées: {len(tracks)}")
                    break
                except json.JSONDecodeError:
                    continue
        
        if not tracks:
            print("Aucune piste de sous-titres trouvée")
            return None
        
        # Trouver la meilleure piste
        selected_track = find_best_track(tracks, language)
        
        if not selected_track:
            print("Aucune piste appropriée trouvée")
            return None
        
        print(f"Piste sélectionnée: {selected_track.get('languageCode', 'unknown')}")
        
        # Télécharger les sous-titres
        return download_captions(selected_track.get('baseUrl'))
        
    except Exception as e:
        print(f"Erreur extraction: {e}")
        return None


def find_best_track(tracks, language):
    """Trouver la meilleure piste de sous-titres"""
    if not tracks:
        return None
    
    print(f"Langues disponibles: {[t.get('languageCode', 'unknown') for t in tracks]}")
    
    # Langue préférée
    for track in tracks:
        if track.get('languageCode') == language:
            return track
    
    # Fallback anglais
    for track in tracks:
        if track.get('languageCode') == 'en':
            return track
    
    # Première piste disponible
    return tracks[0] if tracks else None


def download_captions(base_url):
    """Télécharger et parser les sous-titres"""
    if not base_url:
        print("Pas de baseUrl")
        return None
    
    try:
        print(f"Téléchargement depuis: {base_url}")
        
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/xml,application/xml,application/xhtml+xml,text/html;q=0.9,text/plain;q=0.8,*/*;q=0.5'
        }
        
        req = urllib.request.Request(base_url, headers=headers)
        
        with urllib.request.urlopen(req, timeout=20) as response:
            xml_content = response.read().decode('utf-8', errors='ignore')
        
        print(f"Contenu téléchargé: {len(xml_content)} caractères")
        
        # Parser XML
        text_pattern = r'<text start="([^"]+)"(?:\s+dur="([^"]+)")?>([^<]*)</text>'
        matches = re.findall(text_pattern, xml_content)
        
        print(f"Segments trouvés: {len(matches)}")
        
        subtitles = []
        
        for start, duration, text in matches:
            try:
                start_time = float(start)
                dur_time = float(duration) if duration else 3.0
                
                clean_text = clean_text_content(text)
                
                if clean_text:
                    subtitles.append({
                        'start': start_time,
                        'duration': dur_time,
                        'text': clean_text
                    })
            except ValueError:
                continue
        
        print(f"Sous-titres parsés: {len(subtitles)}")
        return subtitles
        
    except Exception as e:
        print(f"Erreur téléchargement: {e}")
        return None


def clean_text_content(text):
    """Nettoyer le texte des sous-titres"""
    if not text:
        return ''
    
    # Entités HTML
    text = text.replace('&amp;', '&')
    text = text.replace('&lt;', '<')
    text = text.replace('&gt;', '>')
    text = text.replace('&quot;', '"')
    text = text.replace('&#39;', "'")
    
    # Balises HTML
    text = re.sub(r'<[^>]+>', '', text)
    
    # Espaces multiples
    text = ' '.join(text.split())
    
    return text.strip()


def format_output(subtitles, format_type):
    """Formater la sortie selon le type demandé"""
    if not subtitles:
        return ''
    
    if format_type == 'json':
        return json.dumps(subtitles, ensure_ascii=False, indent=2)
    
    elif format_type == 'txt':
        return '\n'.join([item['text'] for item in subtitles])
    
    elif format_type == 'srt':
        srt_content = []
        for i, item in enumerate(subtitles, 1):
            start_time = seconds_to_srt_time(item['start'])
            end_time = seconds_to_srt_time(item['start'] + item['duration'])
            
            srt_content.append(f"{i}")
            srt_content.append(f"{start_time} --> {end_time}")
            srt_content.append(item['text'])
            srt_content.append("")
        
        return '\n'.join(srt_content)
    
    elif format_type == 'vtt':
        vtt_content = ["WEBVTT", ""]
        
        for item in subtitles:
            start_time = seconds_to_vtt_time(item['start'])
            end_time = seconds_to_vtt_time(item['start'] + item['duration'])
            
            vtt_content.append(f"{start_time} --> {end_time}")
            vtt_content.append(item['text'])
            vtt_content.append("")
        
        return '\n'.join(vtt_content)
    
    else:
        return '\n'.join([item['text'] for item in subtitles])


def seconds_to_srt_time(seconds):
    """Convertir les secondes au format SRT (HH:MM:SS,mmm)"""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    milliseconds = int((seconds % 1) * 1000)
    
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{milliseconds:03d}"


def seconds_to_vtt_time(seconds):
    """Convertir les secondes au format VTT (HH:MM:SS.mmm)"""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    milliseconds = int((seconds % 1) * 1000)
    
    return f"{hours:02d}:{minutes:02d}:{secs:02d}.{milliseconds:03d}"


# Point d'entrée requis par Netlify
def main(event, context):
    """Point d'entrée alternatif"""
    return handler(event, context)