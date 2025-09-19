# netlify/functions/subtitles.py
import json
import re
import urllib.request
import urllib.parse
from urllib.error import URLError, HTTPError


def main(event, context):
    """
    Point d'entrée principal pour Netlify Functions Python
    """
    return handler(event, context)


def handler(event, context):
    """
    Fonction Netlify pour extraire les sous-titres YouTube
    """
    # Configuration CORS
    headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json'
    }
    
    # Gérer les requêtes OPTIONS (preflight CORS)
    if event.get('httpMethod') == 'OPTIONS':
        return {
            'statusCode': 200,
            'headers': headers,
            'body': ''
        }
    
    # Vérifier la méthode
    if event.get('httpMethod') != 'POST':
        return {
            'statusCode': 405,
            'headers': headers,
            'body': json.dumps({'error': 'Méthode non autorisée. Utilisez POST.'})
        }
    
    try:
        # Debug logs
        print(f"Event reçu: {event}")
        
        # Parser le body de la requête
        if not event.get('body'):
            return {
                'statusCode': 400,
                'headers': headers,
                'body': json.dumps({'error': 'Corps de requête manquant'})
            }
        
        body = json.loads(event['body'])
        video_id = body.get('videoId')
        format_type = body.get('format', 'txt').lower()
        language = body.get('language', 'fr')
        
        print(f"Paramètres: videoId={video_id}, format={format_type}, language={language}")
        
        # Validation des paramètres
        if not video_id:
            return {
                'statusCode': 400,
                'headers': headers,
                'body': json.dumps({'error': 'ID vidéo manquant'})
            }
        
        if not re.match(r'^[a-zA-Z0-9_-]{11}


def extract_youtube_subtitles(video_id, language='fr'):
    """
    Extraire les sous-titres d'une vidéo YouTube
    """
    try:
        # URL de la page vidéo YouTube
        video_url = f'https://www.youtube.com/watch?v={video_id}'
        
        # Headers pour simuler un navigateur
        headers_browser = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate',
            'Connection': 'keep-alive'
        }
        
        # Créer la requête
        req = urllib.request.Request(video_url, headers=headers_browser)
        
        # Récupérer la page
        with urllib.request.urlopen(req, timeout=30) as response:
            html_content = response.read().decode('utf-8', errors='ignore')
        
        # Extraire les informations de sous-titres depuis le HTML
        caption_tracks = extract_caption_tracks(html_content)
        
        if not caption_tracks:
            return None
        
        # Trouver la piste dans la langue demandée ou en anglais par défaut
        selected_track = find_best_track(caption_tracks, language)
        
        if not selected_track:
            return None
        
        # Télécharger les sous-titres
        return download_subtitle_track(selected_track)
        
    except (URLError, HTTPError) as e:
        print(f"Erreur HTTP lors de l'extraction: {str(e)}")
        return None
    except Exception as e:
        print(f"Erreur lors de l'extraction des sous-titres: {str(e)}")
        return None


def extract_caption_tracks(html_content):
    """
    Extraire les pistes de sous-titres depuis le HTML de la page YouTube
    """
    try:
        # Pattern pour trouver les données de sous-titres dans le JavaScript
        pattern = r'"captions":\s*(\{[^}]+?"captionTracks":\s*\[[^\]]+\][^}]*\})'
        match = re.search(pattern, html_content)
        
        if not match:
            # Pattern alternatif
            pattern = r'"playerCaptionsTracklistRenderer":\s*(\{[^}]+?"captionTracks":\s*\[[^\]]+\][^}]*\})'
            match = re.search(pattern, html_content)
        
        if not match:
            return None
        
        # Parser les données JSON
        captions_data = json.loads(match.group(1))
        caption_tracks = captions_data.get('captionTracks', [])
        
        return caption_tracks
        
    except (json.JSONDecodeError, AttributeError) as e:
        print(f"Erreur lors de l'extraction des pistes: {str(e)}")
        return None


def find_best_track(caption_tracks, preferred_language):
    """
    Trouver la meilleure piste de sous-titres selon la langue préférée
    """
    if not caption_tracks:
        return None
    
    # Essayer de trouver la langue préférée
    for track in caption_tracks:
        if track.get('languageCode') == preferred_language:
            return track
    
    # Fallback vers l'anglais
    for track in caption_tracks:
        if track.get('languageCode') == 'en':
            return track
    
    # Prendre la première piste disponible
    return caption_tracks[0] if caption_tracks else None


def download_subtitle_track(track):
    """
    Télécharger le contenu d'une piste de sous-titres
    """
    try:
        base_url = track.get('baseUrl')
        if not base_url:
            return None
        
        # Headers pour la requête
        headers_subtitle = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/xml,application/xml,application/xhtml+xml,text/html;q=0.9,text/plain;q=0.8,image/png,*/*;q=0.5',
            'Accept-Language': 'en-US,en;q=0.5'
        }
        
        # Créer la requête
        req = urllib.request.Request(base_url, headers=headers_subtitle)
        
        # Télécharger les sous-titres
        with urllib.request.urlopen(req, timeout=20) as response:
            subtitle_content = response.read().decode('utf-8', errors='ignore')
        
        # Parser les sous-titres XML
        return parse_subtitle_xml(subtitle_content)
        
    except Exception as e:
        print(f"Erreur lors du téléchargement des sous-titres: {str(e)}")
        return None


def parse_subtitle_xml(xml_content):
    """
    Parser le contenu XML des sous-titres YouTube
    """
    try:
        # Pattern pour extraire les segments de texte avec timing
        pattern = r'<text start="([^"]+)"(?:\s+dur="([^"]+)")?>([^<]+)</text>'
        matches = re.findall(pattern, xml_content)
        
        subtitles = []
        for start, duration, text in matches:
            try:
                start_time = float(start)
                dur_time = float(duration) if duration else 3.0
                
                # Nettoyer le texte
                clean_text = clean_subtitle_text(text)
                
                if clean_text:
                    subtitles.append({
                        'start': start_time,
                        'duration': dur_time,
                        'text': clean_text
                    })
            except ValueError:
                continue
        
        return subtitles
        
    except Exception as e:
        print(f"Erreur lors du parsing XML: {str(e)}")
        return None


def clean_subtitle_text(text):
    """
    Nettoyer le texte des sous-titres
    """
    if not text:
        return ''
    
    # Décoder les entités HTML
    text = text.replace('&amp;', '&')
    text = text.replace('&lt;', '<')
    text = text.replace('&gt;', '>')
    text = text.replace('&quot;', '"')
    text = text.replace('&#39;', "'")
    
    # Supprimer les balises HTML restantes
    text = re.sub(r'<[^>]+>', '', text)
    
    # Nettoyer les espaces
    text = ' '.join(text.split())
    
    return text.strip()


def format_subtitles(subtitles_data, format_type):
    """
    Formater les sous-titres selon le type demandé
    """
    if not subtitles_data:
        return ''
    
    if format_type == 'json':
        return json.dumps(subtitles_data, ensure_ascii=False, indent=2)
    
    elif format_type == 'txt':
        return '\n'.join([item['text'] for item in subtitles_data])
    
    elif format_type == 'srt':
        srt_content = []
        for i, item in enumerate(subtitles_data, 1):
            start_time = seconds_to_srt_time(item['start'])
            end_time = seconds_to_srt_time(item['start'] + item['duration'])
            
            srt_content.append(f"{i}")
            srt_content.append(f"{start_time} --> {end_time}")
            srt_content.append(item['text'])
            srt_content.append("")
        
        return '\n'.join(srt_content)
    
    elif format_type == 'vtt':
        vtt_content = ["WEBVTT", ""]
        
        for item in subtitles_data:
            start_time = seconds_to_vtt_time(item['start'])
            end_time = seconds_to_vtt_time(item['start'] + item['duration'])
            
            vtt_content.append(f"{start_time} --> {end_time}")
            vtt_content.append(item['text'])
            vtt_content.append("")
        
        return '\n'.join(vtt_content)
    
    else:
        return '\n'.join([item['text'] for item in subtitles_data])


def seconds_to_srt_time(seconds):
    """
    Convertir les secondes au format SRT (HH:MM:SS,mmm)
    """
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    milliseconds = int((seconds % 1) * 1000)
    
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{milliseconds:03d}"


def seconds_to_vtt_time(seconds):
    """
    Convertir les secondes au format VTT (HH:MM:SS.mmm)
    """
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    milliseconds = int((seconds % 1) * 1000)
    
    return f"{hours:02d}:{minutes:02d}:{secs:02d}.{milliseconds:03d}"


# Point d'entrée pour Netlify Functions
def main(event, context):
    return handler(event, context), video_id):
            return {
                'statusCode': 400,
                'headers': headers,
                'body': json.dumps({'error': 'ID vidéo invalide'})
            }
        
        # Extraire les sous-titres
        print(f"Début extraction pour {video_id}")
        subtitles_data = extract_youtube_subtitles(video_id, language)
        
        if not subtitles_data:
            return {
                'statusCode': 404,
                'headers': headers,
                'body': json.dumps({'error': 'Aucun sous-titre trouvé pour cette vidéo'})
            }
        
        # Formater selon le type demandé
        formatted_content = format_subtitles(subtitles_data, format_type)
        
        # Définir le Content-Type selon le format
        content_types = {
            'txt': 'text/plain; charset=utf-8',
            'srt': 'application/x-subrip; charset=utf-8',
            'vtt': 'text/vtt; charset=utf-8',
            'json': 'application/json; charset=utf-8'
        }
        
        headers['Content-Type'] = content_types.get(format_type, 'text/plain; charset=utf-8')
        
        print(f"Succès: {len(formatted_content)} caractères retournés")
        
        return {
            'statusCode': 200,
            'headers': headers,
            'body': formatted_content
        }
        
    except json.JSONDecodeError as e:
        print(f"Erreur JSON: {str(e)}")
        return {
            'statusCode': 400,
            'headers': headers,
            'body': json.dumps({'error': 'JSON invalide dans le corps de la requête'})
        }
    except Exception as e:
        print(f"Erreur dans handler: {str(e)}")
        return {
            'statusCode': 500,
            'headers': headers,
            'body': json.dumps({'error': f'Erreur serveur: {str(e)}'})
        }


def extract_youtube_subtitles(video_id, language='fr'):
    """
    Extraire les sous-titres d'une vidéo YouTube
    """
    try:
        print(f"Extraction pour vidéo: {video_id}, langue: {language}")
        
        # URL de la page vidéo YouTube
        video_url = f'https://www.youtube.com/watch?v={video_id}'
        
        # Headers pour simuler un navigateur
        headers_browser = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate',
            'Connection': 'keep-alive'
        }
        
        # Créer la requête
        req = urllib.request.Request(video_url, headers=headers_browser)
        
        # Récupérer la page
        print(f"Récupération de la page YouTube...")
        with urllib.request.urlopen(req, timeout=30) as response:
            html_content = response.read()
            # Gérer l'encodage
            if response.info().get('Content-Encoding') == 'gzip':
                import gzip
                html_content = gzip.decompress(html_content)
            html_content = html_content.decode('utf-8', errors='ignore')
        
        print(f"Page récupérée: {len(html_content)} caractères")
        
        # Extraire les informations de sous-titres depuis le HTML
        caption_tracks = extract_caption_tracks(html_content)
        
        if not caption_tracks:
            print("Aucune piste de sous-titres trouvée")
            return None
        
        print(f"Pistes trouvées: {len(caption_tracks)}")
        
        # Trouver la piste dans la langue demandée ou en anglais par défaut
        selected_track = find_best_track(caption_tracks, language)
        
        if not selected_track:
            print("Aucune piste appropriée trouvée")
            return None
        
        print(f"Piste sélectionnée: {selected_track.get('languageCode', 'unknown')}")
        
        # Télécharger les sous-titres
        return download_subtitle_track(selected_track)
        
    except (URLError, HTTPError) as e:
        print(f"Erreur HTTP lors de l'extraction: {str(e)}")
        return None
    except Exception as e:
        print(f"Erreur lors de l'extraction des sous-titres: {str(e)}")
        return None


def extract_caption_tracks(html_content):
    """
    Extraire les pistes de sous-titres depuis le HTML de la page YouTube
    """
    try:
        # Pattern pour trouver les données de sous-titres dans le JavaScript
        patterns = [
            r'"captions":\s*(\{[^}]*?"captionTracks":\s*\[[^\]]+\][^}]*\})',
            r'"playerCaptionsTracklistRenderer":\s*(\{[^}]*?"captionTracks":\s*\[[^\]]+\][^}]*\})',
            r'captionTracks["\']:\s*(\[[^\]]+\])'
        ]
        
        for pattern in patterns:
            match = re.search(pattern, html_content)
            if match:
                print(f"Pattern trouvé: {pattern}")
                try:
                    if 'captionTracks' in match.group(1):
                        captions_data = json.loads(match.group(1))
                        return captions_data.get('captionTracks', [])
                    else:
                        # Direct array
                        return json.loads(match.group(1))
                except json.JSONDecodeError as e:
                    print(f"Erreur JSON pour pattern {pattern}: {e}")
                    continue
        
        print("Aucun pattern de sous-titres trouvé")
        return None
        
    except Exception as e:
        print(f"Erreur lors de l'extraction des pistes: {str(e)}")
        return None


def find_best_track(caption_tracks, preferred_language):
    """
    Trouver la meilleure piste de sous-titres selon la langue préférée
    """
    if not caption_tracks:
        return None
    
    print(f"Recherche langue: {preferred_language}")
    print(f"Langues disponibles: {[track.get('languageCode', 'unknown') for track in caption_tracks]}")
    
    # Essayer de trouver la langue préférée
    for track in caption_tracks:
        if track.get('languageCode') == preferred_language:
            print(f"Langue trouvée: {preferred_language}")
            return track
    
    # Fallback vers l'anglais
    for track in caption_tracks:
        if track.get('languageCode') == 'en':
            print("Fallback vers l'anglais")
            return track
    
    # Prendre la première piste disponible
    print("Prise de la première piste disponible")
    return caption_tracks[0] if caption_tracks else None


def download_subtitle_track(track):
    """
    Télécharger le contenu d'une piste de sous-titres
    """
    try:
        base_url = track.get('baseUrl')
        if not base_url:
            print("Pas de baseUrl dans la piste")
            return None
        
        print(f"Téléchargement depuis: {base_url}")
        
        # Headers pour la requête
        headers_subtitle = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/xml,application/xml,application/xhtml+xml,text/html;q=0.9,text/plain;q=0.8,*/*;q=0.5',
            'Accept-Language': 'en-US,en;q=0.5'
        }
        
        # Créer la requête
        req = urllib.request.Request(base_url, headers=headers_subtitle)
        
        # Télécharger les sous-titres
        with urllib.request.urlopen(req, timeout=20) as response:
            subtitle_content = response.read().decode('utf-8', errors='ignore')
        
        print(f"Contenu téléchargé: {len(subtitle_content)} caractères")
        
        # Parser les sous-titres XML
        return parse_subtitle_xml(subtitle_content)
        
    except Exception as e:
        print(f"Erreur lors du téléchargement des sous-titres: {str(e)}")
        return None


def parse_subtitle_xml(xml_content):
    """
    Parser le contenu XML des sous-titres YouTube
    """
    try:
        # Pattern pour extraire les segments de texte avec timing
        pattern = r'<text start="([^"]+)"(?:\s+dur="([^"]+)")?>([^<]+)</text>'
        matches = re.findall(pattern, xml_content)
        
        print(f"Segments trouvés: {len(matches)}")
        
        subtitles = []
        for start, duration, text in matches:
            try:
                start_time = float(start)
                dur_time = float(duration) if duration else 3.0
                
                # Nettoyer le texte
                clean_text = clean_subtitle_text(text)
                
                if clean_text:
                    subtitles.append({
                        'start': start_time,
                        'duration': dur_time,
                        'text': clean_text
                    })
            except ValueError as e:
                print(f"Erreur parsing segment: {e}")
                continue
        
        print(f"Sous-titres parsés: {len(subtitles)}")
        return subtitles
        
    except Exception as e:
        print(f"Erreur lors du parsing XML: {str(e)}")
        return None


def clean_subtitle_text(text):
    """
    Nettoyer le texte des sous-titres
    """
    if not text:
        return ''
    
    # Décoder les entités HTML
    text = text.replace('&amp;', '&')
    text = text.replace('&lt;', '<')
    text = text.replace('&gt;', '>')
    text = text.replace('&quot;', '"')
    text = text.replace('&#39;', "'")
    
    # Supprimer les balises HTML restantes
    text = re.sub(r'<[^>]+>', '', text)
    
    # Nettoyer les espaces
    text = ' '.join(text.split())
    
    return text.strip()


def format_subtitles(subtitles_data, format_type):
    """
    Formater les sous-titres selon le type demandé
    """
    if not subtitles_data:
        return ''
    
    if format_type == 'json':
        return json.dumps(subtitles_data, ensure_ascii=False, indent=2)
    
    elif format_type == 'txt':
        return '\n'.join([item['text'] for item in subtitles_data])
    
    elif format_type == 'srt':
        srt_content = []
        for i, item in enumerate(subtitles_data, 1):
            start_time = seconds_to_srt_time(item['start'])
            end_time = seconds_to_srt_time(item['start'] + item['duration'])
            
            srt_content.append(f"{i}")
            srt_content.append(f"{start_time} --> {end_time}")
            srt_content.append(item['text'])
            srt_content.append("")
        
        return '\n'.join(srt_content)
    
    elif format_type == 'vtt':
        vtt_content = ["WEBVTT", ""]
        
        for item in subtitles_data:
            start_time = seconds_to_vtt_time(item['start'])
            end_time = seconds_to_vtt_time(item['start'] + item['duration'])
            
            vtt_content.append(f"{start_time} --> {end_time}")
            vtt_content.append(item['text'])
            vtt_content.append("")
        
        return '\n'.join(vtt_content)
    
    else:
        return '\n'.join([item['text'] for item in subtitles_data])


def seconds_to_srt_time(seconds):
    """
    Convertir les secondes au format SRT (HH:MM:SS,mmm)
    """
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    milliseconds = int((seconds % 1) * 1000)
    
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{milliseconds:03d}"


def seconds_to_vtt_time(seconds):
    """
    Convertir les secondes au format VTT (HH:MM:SS.mmm)
    """
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    milliseconds = int((seconds % 1) * 1000)
    
    return f"{hours:02d}:{minutes:02d}:{secs:02d}.{milliseconds:03d}"


def extract_youtube_subtitles(video_id, language='fr'):
    """
    Extraire les sous-titres d'une vidéo YouTube
    """
    try:
        # URL de la page vidéo YouTube
        video_url = f'https://www.youtube.com/watch?v={video_id}'
        
        # Headers pour simuler un navigateur
        headers_browser = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate',
            'Connection': 'keep-alive'
        }
        
        # Créer la requête
        req = urllib.request.Request(video_url, headers=headers_browser)
        
        # Récupérer la page
        with urllib.request.urlopen(req, timeout=30) as response:
            html_content = response.read().decode('utf-8', errors='ignore')
        
        # Extraire les informations de sous-titres depuis le HTML
        caption_tracks = extract_caption_tracks(html_content)
        
        if not caption_tracks:
            return None
        
        # Trouver la piste dans la langue demandée ou en anglais par défaut
        selected_track = find_best_track(caption_tracks, language)
        
        if not selected_track:
            return None
        
        # Télécharger les sous-titres
        return download_subtitle_track(selected_track)
        
    except (URLError, HTTPError) as e:
        print(f"Erreur HTTP lors de l'extraction: {str(e)}")
        return None
    except Exception as e:
        print(f"Erreur lors de l'extraction des sous-titres: {str(e)}")
        return None


def extract_caption_tracks(html_content):
    """
    Extraire les pistes de sous-titres depuis le HTML de la page YouTube
    """
    try:
        # Pattern pour trouver les données de sous-titres dans le JavaScript
        pattern = r'"captions":\s*(\{[^}]+?"captionTracks":\s*\[[^\]]+\][^}]*\})'
        match = re.search(pattern, html_content)
        
        if not match:
            # Pattern alternatif
            pattern = r'"playerCaptionsTracklistRenderer":\s*(\{[^}]+?"captionTracks":\s*\[[^\]]+\][^}]*\})'
            match = re.search(pattern, html_content)
        
        if not match:
            return None
        
        # Parser les données JSON
        captions_data = json.loads(match.group(1))
        caption_tracks = captions_data.get('captionTracks', [])
        
        return caption_tracks
        
    except (json.JSONDecodeError, AttributeError) as e:
        print(f"Erreur lors de l'extraction des pistes: {str(e)}")
        return None


def find_best_track(caption_tracks, preferred_language):
    """
    Trouver la meilleure piste de sous-titres selon la langue préférée
    """
    if not caption_tracks:
        return None
    
    # Essayer de trouver la langue préférée
    for track in caption_tracks:
        if track.get('languageCode') == preferred_language:
            return track
    
    # Fallback vers l'anglais
    for track in caption_tracks:
        if track.get('languageCode') == 'en':
            return track
    
    # Prendre la première piste disponible
    return caption_tracks[0] if caption_tracks else None


def download_subtitle_track(track):
    """
    Télécharger le contenu d'une piste de sous-titres
    """
    try:
        base_url = track.get('baseUrl')
        if not base_url:
            return None
        
        # Headers pour la requête
        headers_subtitle = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/xml,application/xml,application/xhtml+xml,text/html;q=0.9,text/plain;q=0.8,image/png,*/*;q=0.5',
            'Accept-Language': 'en-US,en;q=0.5'
        }
        
        # Créer la requête
        req = urllib.request.Request(base_url, headers=headers_subtitle)
        
        # Télécharger les sous-titres
        with urllib.request.urlopen(req, timeout=20) as response:
            subtitle_content = response.read().decode('utf-8', errors='ignore')
        
        # Parser les sous-titres XML
        return parse_subtitle_xml(subtitle_content)
        
    except Exception as e:
        print(f"Erreur lors du téléchargement des sous-titres: {str(e)}")
        return None


def parse_subtitle_xml(xml_content):
    """
    Parser le contenu XML des sous-titres YouTube
    """
    try:
        # Pattern pour extraire les segments de texte avec timing
        pattern = r'<text start="([^"]+)"(?:\s+dur="([^"]+)")?>([^<]+)</text>'
        matches = re.findall(pattern, xml_content)
        
        subtitles = []
        for start, duration, text in matches:
            try:
                start_time = float(start)
                dur_time = float(duration) if duration else 3.0
                
                # Nettoyer le texte
                clean_text = clean_subtitle_text(text)
                
                if clean_text:
                    subtitles.append({
                        'start': start_time,
                        'duration': dur_time,
                        'text': clean_text
                    })
            except ValueError:
                continue
        
        return subtitles
        
    except Exception as e:
        print(f"Erreur lors du parsing XML: {str(e)}")
        return None


def clean_subtitle_text(text):
    """
    Nettoyer le texte des sous-titres
    """
    if not text:
        return ''
    
    # Décoder les entités HTML
    text = text.replace('&amp;', '&')
    text = text.replace('&lt;', '<')
    text = text.replace('&gt;', '>')
    text = text.replace('&quot;', '"')
    text = text.replace('&#39;', "'")
    
    # Supprimer les balises HTML restantes
    text = re.sub(r'<[^>]+>', '', text)
    
    # Nettoyer les espaces
    text = ' '.join(text.split())
    
    return text.strip()


def format_subtitles(subtitles_data, format_type):
    """
    Formater les sous-titres selon le type demandé
    """
    if not subtitles_data:
        return ''
    
    if format_type == 'json':
        return json.dumps(subtitles_data, ensure_ascii=False, indent=2)
    
    elif format_type == 'txt':
        return '\n'.join([item['text'] for item in subtitles_data])
    
    elif format_type == 'srt':
        srt_content = []
        for i, item in enumerate(subtitles_data, 1):
            start_time = seconds_to_srt_time(item['start'])
            end_time = seconds_to_srt_time(item['start'] + item['duration'])
            
            srt_content.append(f"{i}")
            srt_content.append(f"{start_time} --> {end_time}")
            srt_content.append(item['text'])
            srt_content.append("")
        
        return '\n'.join(srt_content)
    
    elif format_type == 'vtt':
        vtt_content = ["WEBVTT", ""]
        
        for item in subtitles_data:
            start_time = seconds_to_vtt_time(item['start'])
            end_time = seconds_to_vtt_time(item['start'] + item['duration'])
            
            vtt_content.append(f"{start_time} --> {end_time}")
            vtt_content.append(item['text'])
            vtt_content.append("")
        
        return '\n'.join(vtt_content)
    
    else:
        return '\n'.join([item['text'] for item in subtitles_data])


def seconds_to_srt_time(seconds):
    """
    Convertir les secondes au format SRT (HH:MM:SS,mmm)
    """
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    milliseconds = int((seconds % 1) * 1000)
    
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{milliseconds:03d}"


def seconds_to_vtt_time(seconds):
    """
    Convertir les secondes au format VTT (HH:MM:SS.mmm)
    """
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    milliseconds = int((seconds % 1) * 1000)
    
    return f"{hours:02d}:{minutes:02d}:{secs:02d}.{milliseconds:03d}"


# Point d'entrée pour Netlify Functions
def main(event, context):
    return handler(event, context)