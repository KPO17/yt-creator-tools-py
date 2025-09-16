// netlify/functions/subtitles.js
// NOUVELLE APPROCHE avec youtube-transcript-api (Python)

const { spawn } = require('child_process');
const path = require('path');

exports.handler = async (event, context) => {
  // Headers CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Gérer les requêtes OPTIONS (preflight)
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Méthode non autorisée' })
    };
  }

  try {
    const { videoId, format = 'srt', language = 'fr' } = JSON.parse(event.body);

    if (!videoId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'ID vidéo manquant' })
      };
    }

    // Validation de l'ID vidéo
    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'ID vidéo YouTube invalide' })
      };
    }

    console.log(`[Subtitles] Extraction pour vidéo: ${videoId}, format: ${format}, langue: ${language}`);

    // Exécuter le script Python pour extraire les sous-titres
    const subtitleData = await extractSubtitlesWithPython(videoId, language, format);
    
    if (!subtitleData || subtitleData.error) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({
          error: subtitleData?.error || 'Aucun sous-titre disponible pour cette vidéo',
          details: 'La vidéo n\'a peut-être pas de sous-titres publics ou est privée'
        })
      };
    }

    return {
      statusCode: 200,
      headers: {
        ...headers,
        'Content-Type': format === 'json' ? 'application/json' : 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="${videoId}_subtitles.${format}"`
      },
      body: subtitleData.content
    };

  } catch (error) {
    console.error('[Subtitles] Erreur:', error);
    
    let errorMessage = 'Erreur lors de l\'extraction des sous-titres';
    let statusCode = 500;

    if (error.message.includes('not found')) {
      errorMessage = 'Aucun sous-titre trouvé pour cette vidéo';
      statusCode = 404;
    } else if (error.message.includes('private')) {
      errorMessage = 'Cette vidéo est privée ou n\'a pas de sous-titres publics';
      statusCode = 403;
    } else if (error.message.includes('disabled')) {
      errorMessage = 'Les sous-titres sont désactivés pour cette vidéo';
      statusCode = 404;
    }

    return {
      statusCode,
      headers,
      body: JSON.stringify({ 
        error: errorMessage,
        videoId: JSON.parse(event.body).videoId,
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      })
    };
  }
};

// Fonction pour extraire les sous-titres avec Python
async function extractSubtitlesWithPython(videoId, language, format) {
  return new Promise((resolve, reject) => {
    // Script Python inline pour éviter les fichiers externes
    const pythonScript = `
import sys
import json
import re
from youtube_transcript_api import YouTubeTranscriptApi

def convert_to_srt(transcript):
    srt_content = ""
    for i, entry in enumerate(transcript):
        start_time = format_time(entry['start'])
        end_time = format_time(entry['start'] + entry['duration'])
        text = entry['text'].replace('\\n', ' ')
        
        srt_content += f"{i + 1}\\n"
        srt_content += f"{start_time} --> {end_time}\\n"
        srt_content += f"{text}\\n\\n"
    
    return srt_content

def convert_to_vtt(transcript):
    vtt_content = "WEBVTT\\n\\n"
    for entry in transcript:
        start_time = format_time_vtt(entry['start'])
        end_time = format_time_vtt(entry['start'] + entry['duration'])
        text = entry['text'].replace('\\n', ' ')
        
        vtt_content += f"{start_time} --> {end_time}\\n"
        vtt_content += f"{text}\\n\\n"
    
    return vtt_content

def convert_to_txt(transcript):
    return " ".join([entry['text'] for entry in transcript])

def format_time(seconds):
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millisecs = int((seconds % 1) * 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millisecs:03d}"

def format_time_vtt(seconds):
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millisecs = int((seconds % 1) * 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}.{millisecs:03d}"

try:
    video_id = sys.argv[1]
    language = sys.argv[2] if len(sys.argv) > 2 else 'fr'
    format_type = sys.argv[3] if len(sys.argv) > 3 else 'srt'
    
    # Essayer plusieurs langues par ordre de priorité
    languages = [language, 'fr', 'en', 'auto']
    
    transcript = None
    used_language = None
    
    for lang in languages:
        try:
            if lang == 'auto':
                # Récupérer n'importe quelle langue disponible
                transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)
                transcript_obj = next(iter(transcript_list))
                transcript = transcript_obj.fetch()
                used_language = transcript_obj.language_code
                break
            else:
                transcript = YouTubeTranscriptApi.get_transcript(video_id, languages=[lang])
                used_language = lang
                break
        except:
            continue
    
    if not transcript:
        print(json.dumps({"error": "No transcript found"}))
        sys.exit(1)
    
    # Convertir selon le format demandé
    if format_type == 'srt':
        content = convert_to_srt(transcript)
    elif format_type == 'vtt':
        content = convert_to_vtt(transcript)
    elif format_type == 'txt':
        content = convert_to_txt(transcript)
    elif format_type == 'json':
        content = json.dumps({
            'videoId': video_id,
            'language': used_language,
            'transcript': transcript
        }, ensure_ascii=False, indent=2)
    else:
        content = convert_to_srt(transcript)  # Par défaut SRT
    
    result = {
        'content': content,
        'language': used_language,
        'format': format_type,
        'segments': len(transcript)
    }
    
    print(json.dumps(result, ensure_ascii=False))

except Exception as e:
    error_msg = str(e)
    if 'could not retrieve a transcript' in error_msg.lower():
        print(json.dumps({"error": "No transcript available for this video"}))
    elif 'video is unavailable' in error_msg.lower():
        print(json.dumps({"error": "Video is unavailable or private"}))
    elif 'transcript disabled' in error_msg.lower():
        print(json.dumps({"error": "Transcripts are disabled for this video"}))
    else:
        print(json.dumps({"error": f"Extraction failed: {error_msg}"}))
    sys.exit(1)
`;

    // Exécuter le script Python
    const pythonProcess = spawn('python3', ['-c', pythonScript, videoId, language, format], {
      stdio: 'pipe',
      cwd: process.cwd()
    });

    let output = '';
    let errorOutput = '';

    pythonProcess.stdout.on('data', (data) => {
      output += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    pythonProcess.on('close', (code) => {
      if (code === 0 && output) {
        try {
          const result = JSON.parse(output.trim());
          if (result.error) {
            reject(new Error(result.error));
          } else {
            resolve(result);
          }
        } catch (parseError) {
          console.error('[Python] Erreur parsing JSON:', parseError, 'Output:', output);
          reject(new Error('Erreur de traitement des données'));
        }
      } else {
        console.error('[Python] Erreur:', errorOutput, 'Code:', code);
        
        // Analyser les erreurs communes
        if (errorOutput.includes('ModuleNotFoundError') || errorOutput.includes('youtube_transcript_api')) {
          reject(new Error('Module youtube-transcript-api non installé'));
        } else if (errorOutput.includes('could not retrieve a transcript')) {
          reject(new Error('not found'));
        } else if (errorOutput.includes('private') || errorOutput.includes('unavailable')) {
          reject(new Error('private'));
        } else {
          reject(new Error(errorOutput || 'Erreur Python inconnue'));
        }
      }
    });

    pythonProcess.on('error', (error) => {
      if (error.code === 'ENOENT') {
        reject(new Error('Python3 non installé sur le serveur'));
      } else {
        reject(new Error(`Erreur lancement Python: ${error.message}`));
      }
    });

    // Timeout après 30 secondes
    setTimeout(() => {
      pythonProcess.kill();
      reject(new Error('Timeout - extraction trop longue'));
    }, 30000);
  });
}