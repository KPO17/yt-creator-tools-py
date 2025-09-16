// netlify/functions/subtitles.js
const { spawn } = require('child_process');

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
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

    console.log(`Extraction sous-titres: ${videoId}, format: ${format}, langue: ${language}`);

    // Utiliser youtube-transcript-api (Python)
    const result = await new Promise((resolve, reject) => {
      const pythonProcess = spawn('python3', [
        '-c',
        `
import sys
import json
from youtube_transcript_api import YouTubeTranscriptApi

try:
    # Essayer d'abord avec la langue spécifiée
    transcript = YouTubeTranscriptApi.get_transcript('${videoId}', languages=['${language}'])
    result = {
        'status': 'success',
        'data': transcript,
        'language': '${language}',
        'videoId': '${videoId}'
    }
    print(json.dumps(result))
except Exception as e:
    try:
        # Fallback: essayer sans langue spécifique
        transcript = YouTubeTranscriptApi.get_transcript('${videoId}')
        result = {
            'status': 'success',
            'data': transcript,
            'language': 'auto',
            'videoId': '${videoId}'
        }
        print(json.dumps(result))
    except Exception as fallback_error:
        error_result = {
            'status': 'error',
            'message': str(fallback_error),
            'videoId': '${videoId}'
        }
        print(json.dumps(error_result))
        sys.exit(1)
`
      ]);

      let output = '';
      let error = '';

      pythonProcess.stdout.on('data', (data) => output += data.toString());
      pythonProcess.stderr.on('data', (data) => error += data.toString());

      pythonProcess.on('close', (code) => {
        if (code === 0) {
          try {
            const parsed = JSON.parse(output);
            resolve(parsed);
          } catch (e) {
            reject(new Error(`Parse error: ${e.message}, output: ${output}`));
          }
        } else {
          reject(new Error(`Python error (code ${code}): ${error || output}`));
        }
      });

      pythonProcess.on('error', (err) => {
        reject(new Error(`Process error: ${err.message}`));
      });

      // Timeout après 30 secondes
      setTimeout(() => {
        pythonProcess.kill();
        reject(new Error('Timeout après 30 secondes'));
      }, 30000);
    });

    if (result.status === 'error') {
      console.error('Erreur extraction:', result.message);
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ 
          error: 'Sous-titres non disponibles',
          details: result.message 
        })
      };
    }

    // Convertir au format demandé
    let content;
    let contentType = 'text/plain; charset=utf-8';
    
    switch (format) {
      case 'srt':
        content = convertToSrt(result.data);
        break;
      case 'vtt':
        content = convertToVtt(result.data);
        break;
      case 'txt':
        content = convertToTxt(result.data);
        break;
      case 'json':
        content = JSON.stringify(result, null, 2);
        contentType = 'application/json';
        break;
      default:
        content = convertToSrt(result.data);
    }

    console.log(`Succès: ${result.data.length} segments extraits en ${result.language}`);

    return {
      statusCode: 200,
      headers: {
        ...headers,
        'Content-Type': contentType
      },
      body: content
    };

  } catch (error) {
    console.error('Erreur fonction sous-titres:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Erreur lors de l\'extraction',
        details: process.env.NODE_ENV === 'development' ? error.message : 'Erreur interne'
      })
    };
  }
};

// Fonctions de conversion
function convertToSrt(transcript) {
  return transcript.map((entry, index) => {
    const start = formatTime(entry.start);
    const end = formatTime(entry.start + entry.duration);
    return `${index + 1}\n${start} --> ${end}\n${entry.text}\n`;
  }).join('\n');
}

function convertToVtt(transcript) {
  const header = 'WEBVTT\n\n';
  const body = transcript.map((entry, index) => {
    const start = formatTime(entry.start).replace(',', '.');
    const end = formatTime(entry.start + entry.duration).replace(',', '.');
    return `${index + 1}\n${start} --> ${end}\n${entry.text}\n`;
  }).join('\n');
  return header + body;
}

function convertToTxt(transcript) {
  return transcript.map(entry => entry.text).join('\n');
}

function formatTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = (seconds % 60).toFixed(3);
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.padStart(6, '0')}`;
}