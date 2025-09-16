// netlify/functions/subtitles.js
// VERSION CORRIGÉE avec gestion d'erreur améliorée

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

exports.handler = async (event, context) => {
  console.log('=== DÉBUT FONCTION SUBTITLES ===');
  console.log('Method:', event.httpMethod);
  console.log('Body:', event.body);

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Méthode non autorisée' })
    };
  }

  try {
    let requestData;
    try {
      requestData = JSON.parse(event.body || '{}');
    } catch (parseError) {
      console.error('Erreur parsing JSON:', parseError);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'JSON invalide' })
      };
    }

    const { videoId, format = 'srt', language = 'fr' } = requestData;

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

    console.log(`Extraction pour vidéo: ${videoId}, format: ${format}, langue: ${language}`);

    // ÉTAPE 1: Vérifier que Python existe
    const pythonCheck = await checkPythonAvailability();
    if (!pythonCheck.available) {
      console.error('Python non disponible:', pythonCheck.error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ 
          error: 'Configuration serveur incomplète (Python non disponible)',
          details: pythonCheck.error
        })
      };
    }

    // ÉTAPE 2: Vérifier les modules Python
    const moduleCheck = await checkPythonModules();
    if (!moduleCheck.available) {
      console.error('Modules Python manquants:', moduleCheck.error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ 
          error: 'Configuration serveur incomplète (module Python manquant)',
          details: moduleCheck.error
        })
      };
    }

    // ÉTAPE 3: Extraire les sous-titres
    const subtitleData = await extractSubtitlesWithPython(videoId, language, format);
    
    if (!subtitleData || subtitleData.error) {
      const errorMsg = subtitleData?.error || 'Aucun sous-titre disponible';
      console.log('Erreur extraction:', errorMsg);
      
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({
          error: errorMsg,
          details: 'La vidéo n\'a peut-être pas de sous-titres publics ou est privée'
        })
      };
    }

    console.log('Extraction réussie, segments:', subtitleData.segments);
    
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
    console.error('ERREUR GLOBALE:', error);
    console.error('Stack:', error.stack);
    
    let errorMessage = 'Erreur lors de l\'extraction des sous-titres';
    let statusCode = 500;

    if (error.message.includes('not found')) {
      errorMessage = 'Aucun sous-titre trouvé pour cette vidéo';
      statusCode = 404;
    } else if (error.message.includes('private') || error.message.includes('unavailable')) {
      errorMessage = 'Cette vidéo est privée ou n\'a pas de sous-titres publics';
      statusCode = 403;
    } else if (error.message.includes('timeout')) {
      errorMessage = 'Temps d\'extraction dépassé';
      statusCode = 408;
    }

    return {
      statusCode,
      headers,
      body: JSON.stringify({ 
        error: errorMessage,
        videoId: requestData?.videoId,
        timestamp: new Date().toISOString(),
        details: process.env.NODE_ENV === 'development' ? error.message : 'Erreur serveur interne'
      })
    };
  }
};

// NOUVELLE FONCTION: Vérifier la disponibilité de Python
async function checkPythonAvailability() {
  return new Promise((resolve) => {
    const pythonProcess = spawn('python3', ['--version'], { stdio: 'pipe' });
    
    let output = '';
    pythonProcess.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    pythonProcess.stderr.on('data', (data) => {
      output += data.toString();
    });

    pythonProcess.on('close', (code) => {
      if (code === 0) {
        console.log('Python version:', output.trim());
        resolve({ available: true, version: output.trim() });
      } else {
        resolve({ available: false, error: 'Python3 non trouvé' });
      }
    });

    pythonProcess.on('error', (error) => {
      resolve({ available: false, error: error.message });
    });

    setTimeout(() => {
      pythonProcess.kill();
      resolve({ available: false, error: 'Timeout vérification Python' });
    }, 5000);
  });
}

// NOUVELLE FONCTION: Vérifier les modules Python
async function checkPythonModules() {
  return new Promise((resolve) => {
    const checkScript = `
try:
    import youtube_transcript_api
    import requests
    print("MODULES_OK")
except ImportError as e:
    print(f"MODULE_MISSING: {str(e)}")
except Exception as e:
    print(f"MODULE_ERROR: {str(e)}")
`;

    const pythonProcess = spawn('python3', ['-c', checkScript], { stdio: 'pipe' });
    
    let output = '';
    let errorOutput = '';
    
    pythonProcess.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    pythonProcess.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    pythonProcess.on('close', (code) => {
      console.log('Check modules output:', output.trim());
      
      if (output.includes('MODULES_OK')) {
        resolve({ available: true });
      } else if (output.includes('MODULE_MISSING')) {
        resolve({ available: false, error: output.trim() });
      } else {
        resolve({ available: false, error: errorOutput || 'Erreur modules inconnue' });
      }
    });

    pythonProcess.on('error', (error) => {
      resolve({ available: false, error: error.message });
    });

    setTimeout(() => {
      pythonProcess.kill();
      resolve({ available: false, error: 'Timeout vérification modules' });
    }, 5000);
  });
}

// Fonction améliorée pour extraire les sous-titres
async function extractSubtitlesWithPython(videoId, language, format) {
  return new Promise((resolve, reject) => {
    const pythonScript = `
import sys
import json
import traceback

def main():
    try:
        # Import avec gestion d'erreur détaillée
        try:
            from youtube_transcript_api import YouTubeTranscriptApi
        except ImportError as e:
            print(json.dumps({"error": f"Module manquant: {str(e)}"}))
            sys.exit(1)
        
        # Récupérer les paramètres
        video_id = sys.argv[1] if len(sys.argv) > 1 else None
        language = sys.argv[2] if len(sys.argv) > 2 else 'fr'
        format_type = sys.argv[3] if len(sys.argv) > 3 else 'srt'
        
        if not video_id:
            print(json.dumps({"error": "ID vidéo manquant"}))
            sys.exit(1)
        
        print(f"DEBUG: Traitement {video_id}, langue {language}, format {format_type}", file=sys.stderr)
        
        # Essayer d'obtenir les sous-titres
        transcript = None
        used_language = None
        available_languages = []
        
        try:
            # Lister les langues disponibles
            transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)
            available_languages = [t.language_code for t in transcript_list]
            print(f"DEBUG: Langues disponibles: {available_languages}", file=sys.stderr)
            
            # Essayer la langue demandée
            try:
                transcript = YouTubeTranscriptApi.get_transcript(video_id, languages=[language])
                used_language = language
            except:
                # Fallback sur français puis anglais
                for fallback_lang in ['fr', 'en']:
                    if fallback_lang in available_languages:
                        try:
                            transcript = YouTubeTranscriptApi.get_transcript(video_id, languages=[fallback_lang])
                            used_language = fallback_lang
                            break
                        except:
                            continue
                
                # Si toujours rien, prendre la première disponible
                if not transcript and available_languages:
                    first_transcript = next(iter(transcript_list))
                    transcript = first_transcript.fetch()
                    used_language = first_transcript.language_code
                    
        except Exception as e:
            error_msg = str(e).lower()
            if 'could not retrieve' in error_msg or 'no transcripts' in error_msg:
                print(json.dumps({"error": "Aucun sous-titre trouvé pour cette vidéo"}))
            elif 'video unavailable' in error_msg or 'private' in error_msg:
                print(json.dumps({"error": "Vidéo indisponible ou privée"}))
            elif 'disabled' in error_msg:
                print(json.dumps({"error": "Sous-titres désactivés"}))
            else:
                print(json.dumps({"error": f"Erreur API: {str(e)}"}))
            sys.exit(1)
        
        if not transcript:
            print(json.dumps({"error": "Impossible d'obtenir les sous-titres"}))
            sys.exit(1)
        
        print(f"DEBUG: Transcript obtenu, {len(transcript)} segments", file=sys.stderr)
        
        # Convertir selon le format
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
                'availableLanguages': available_languages,
                'transcript': transcript
            }, ensure_ascii=False, indent=2)
        else:
            content = convert_to_srt(transcript)
        
        result = {
            'content': content,
            'language': used_language,
            'format': format_type,
            'segments': len(transcript),
            'availableLanguages': available_languages
        }
        
        print(json.dumps(result, ensure_ascii=False))
        
    except Exception as e:
        print(f"DEBUG: Exception globale: {str(e)}", file=sys.stderr)
        print(f"DEBUG: Traceback: {traceback.format_exc()}", file=sys.stderr)
        print(json.dumps({"error": f"Erreur inattendue: {str(e)}"}))
        sys.exit(1)

def convert_to_srt(transcript):
    srt_content = ""
    for i, entry in enumerate(transcript):
        start_time = format_time(entry['start'])
        end_time = format_time(entry['start'] + entry['duration'])
        text = entry['text'].replace('\\n', ' ').strip()
        
        srt_content += f"{i + 1}\\n"
        srt_content += f"{start_time} --> {end_time}\\n"
        srt_content += f"{text}\\n\\n"
    
    return srt_content

def convert_to_vtt(transcript):
    vtt_content = "WEBVTT\\n\\n"
    for entry in transcript:
        start_time = format_time_vtt(entry['start'])
        end_time = format_time_vtt(entry['start'] + entry['duration'])
        text = entry['text'].replace('\\n', ' ').strip()
        
        vtt_content += f"{start_time} --> {end_time}\\n"
        vtt_content += f"{text}\\n\\n"
    
    return vtt_content

def convert_to_txt(transcript):
    texts = [entry['text'].strip() for entry in transcript if entry['text'].strip()]
    return " ".join(texts)

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

if __name__ == "__main__":
    main()
`;

    console.log('Lancement script Python...');
    const pythonProcess = spawn('python3', ['-c', pythonScript, videoId, language, format], {
      stdio: 'pipe',
      cwd: process.cwd(),
      env: { ...process.env, PYTHONPATH: '/opt/buildhome/python3.9/lib/python3.9/site-packages' }
    });

    let output = '';
    let errorOutput = '';

    pythonProcess.stdout.on('data', (data) => {
      output += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      errorOutput += data.toString();
      console.log('Python stderr:', data.toString());
    });

    pythonProcess.on('close', (code) => {
      console.log('Python terminé, code:', code);
      console.log('Output length:', output.length);
      console.log('Error output:', errorOutput);

      if (code === 0 && output.trim()) {
        try {
          const result = JSON.parse(output.trim());
          if (result.error) {
            reject(new Error(result.error));
          } else {
            resolve(result);
          }
        } catch (parseError) {
          console.error('Erreur parsing JSON:', parseError);
          console.error('Raw output:', output);
          reject(new Error('Erreur de traitement des données'));
        }
      } else {
        console.error('Erreur Python, code:', code, 'stderr:', errorOutput);
        
        if (errorOutput.includes('ModuleNotFoundError') || errorOutput.includes('youtube_transcript_api')) {
          reject(new Error('Module youtube-transcript-api non installé'));
        } else if (errorOutput.includes('could not retrieve a transcript')) {
          reject(new Error('not found'));
        } else if (errorOutput.includes('private') || errorOutput.includes('unavailable')) {
          reject(new Error('private'));
        } else {
          reject(new Error(errorOutput || output || 'Erreur Python inconnue'));
        }
      }
    });

    pythonProcess.on('error', (error) => {
      console.error('Erreur spawn Python:', error);
      if (error.code === 'ENOENT') {
        reject(new Error('Python3 non installé sur le serveur'));
      } else {
        reject(new Error(`Erreur lancement Python: ${error.message}`));
      }
    });

    // Timeout de 45 secondes
    setTimeout(() => {
      console.log('Timeout Python, kill du process');
      pythonProcess.kill('SIGTERM');
      reject(new Error('timeout'));
    }, 45000);
  });
}