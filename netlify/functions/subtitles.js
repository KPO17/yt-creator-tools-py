// netlify/functions/subtitles.js - VERSION AVEC YTDL-CORE
const ytdl = require('ytdl-core');

// Configuration
const CONFIG = {
  DEBUG: process.env.NODE_ENV !== 'production',
  TIMEOUT: 30000, // 30s
  MAX_RETRIES: 2
};

// Logger simple
function log(level, message, data = null) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}`);
  if (data && CONFIG.DEBUG) {
    console.log('Data:', JSON.stringify(data, null, 2).substring(0, 500));
  }
}

exports.handler = async (event, context) => {
  const startTime = Date.now();
  
  // Headers CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'X-Content-Type-Options': 'nosniff'
  };

  // Gestion CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Validation méthode
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Méthode non autorisée' })
    };
  }

  const requestId = Math.random().toString(36).substring(7);
  log('info', `Nouvelle requête [${requestId}]`);

  // Parsing du body
  let requestData = {};
  try {
    if (!event.body) throw new Error('Body vide');
    requestData = JSON.parse(event.body);
  } catch (parseError) {
    log('error', `Erreur parsing JSON [${requestId}]`, parseError.message);
    return {
      statusCode: 400,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'JSON invalide', requestId })
    };
  }

  // Extraction des paramètres
  const { videoId, format = 'srt', language = 'fr' } = requestData;

  // Validations
  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return createErrorResponse(400, 'ID vidéo YouTube invalide', requestId, headers);
  }

  const allowedFormats = ['srt', 'vtt', 'txt', 'json'];
  if (!allowedFormats.includes(format.toLowerCase())) {
    return createErrorResponse(400, `Format non supporté: ${format}`, requestId, headers);
  }

  log('info', `Extraction [${requestId}]`, { videoId, format, language });

  try {
    // Extraire les sous-titres avec ytdl-core
    const subtitles = await extractSubtitlesWithYtdl(videoId, language, requestId);
    
    if (!subtitles || subtitles.length === 0) {
      return createErrorResponse(404, 'Aucun sous-titre disponible', requestId, headers);
    }

    // Convertir au format demandé
    const convertedContent = convertSubtitles(subtitles, format);
    const duration = Date.now() - startTime;
    
    log('info', `Succès [${requestId}]`, { 
      segments: subtitles.length,
      duration: `${duration}ms`
    });

    return {
      statusCode: 200,
      headers: {
        ...headers,
        'Content-Type': getContentType(format),
        'Content-Disposition': `attachment; filename="${videoId}_subtitles.${format}"`,
        'X-Request-ID': requestId,
        'X-Processing-Time': `${duration}ms`
      },
      body: convertedContent
    };

  } catch (error) {
    const duration = Date.now() - startTime;
    log('error', `Erreur [${requestId}]`, { message: error.message, duration: `${duration}ms` });

    // Classification des erreurs
    let statusCode = 500;
    let message = 'Erreur interne du serveur';

    if (error.message.includes('not found') || error.message.includes('404')) {
      statusCode = 404;
      message = 'Vidéo non trouvée ou sous-titres indisponibles';
    } else if (error.message.includes('timeout')) {
      statusCode = 408;
      message = 'Délai d\'attente dépassé';
    } else if (error.message.includes('private') || error.message.includes('unavailable')) {
      statusCode = 403;
      message = 'Vidéo privée ou indisponible';
    } else if (error.message.includes('age-restricted')) {
      statusCode = 403;
      message = 'Vidéo soumise à restriction d\'âge';
    }

    return createErrorResponse(statusCode, message, requestId, headers);
  }
};

// Extraction avec ytdl-core
async function extractSubtitlesWithYtdl(videoId, language, requestId, attempt = 1) {
  const maxAttempts = CONFIG.MAX_RETRIES + 1;
  
  try {
    log('info', `Tentative ${attempt}/${maxAttempts} [${requestId}]`);
    
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    
    // Vérifier si la vidéo existe et est accessible
    const isValid = await Promise.race([
      ytdl.validateURL(videoUrl),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout validation')), 10000)
      )
    ]);
    
    if (!isValid) {
      throw new Error('URL vidéo invalide ou inaccessible');
    }
    
    // Obtenir les informations de la vidéo
    const info = await Promise.race([
      ytdl.getInfo(videoUrl, {
        requestOptions: {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
          }
        }
      }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout')), CONFIG.TIMEOUT)
      )
    ]);

    // Extraire les sous-titres disponibles
    const { player_response } = info;
    const captions = player_response?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    
    if (!captions || captions.length === 0) {
      throw new Error('Aucun sous-titre trouvé pour cette vidéo');
    }
    
    // Trouver les sous-titres dans la langue demandée
    let selectedTrack = null;
    
    if (language && language !== 'auto') {
      selectedTrack = captions.find(track => 
        track.languageCode === language || 
        track.languageCode.startsWith(language.substring(0, 2))
      );
    }
    
    // Si pas de langue spécifique trouvée, prendre le premier disponible
    if (!selectedTrack) {
      selectedTrack = captions[0];
      log('info', `Langue ${language} non trouvée, utilisation de ${selectedTrack.languageCode} [${requestId}]`);
    }
    
    // Télécharger le contenu des sous-titres
    const subtitleUrl = selectedTrack.baseUrl;
    const subtitleResponse = await fetch(subtitleUrl);
    
    if (!subtitleResponse.ok) {
      throw new Error(`Erreur téléchargement sous-titres: ${subtitleResponse.status}`);
    }
    
    const subtitleXml = await subtitleResponse.text();
    
    // Parser le XML des sous-titres
    const subtitles = parseYouTubeSubtitles(subtitleXml);
    
    log('info', `Sous-titres extraits [${requestId}]`, { 
      count: subtitles.length,
      language: selectedTrack.languageCode 
    });
    
    return subtitles;
    
  } catch (error) {
    log('warn', `Échec tentative ${attempt} [${requestId}]: ${error.message}`);
    
    if (attempt < maxAttempts) {
      // Backoff exponentiel
      const delay = Math.min(2000 * Math.pow(2, attempt - 1), 10000);
      await new Promise(resolve => setTimeout(resolve, delay));
      return extractSubtitlesWithYtdl(videoId, language, requestId, attempt + 1);
    }
    
    throw error;
  }
}

// Parser XML des sous-titres YouTube
function parseYouTubeSubtitles(xmlContent) {
  const subtitles = [];
  
  // Expression régulière pour extraire les segments de sous-titres
  const textRegex = /<text start="([^"]*)" dur="([^"]*)"[^>]*>([^<]*)<\/text>/g;
  
  let match;
  while ((match = textRegex.exec(xmlContent)) !== null) {
    const start = parseFloat(match[1]);
    const duration = parseFloat(match[2]) || 2.0;
    let text = match[3];
    
    // Décoder les entités HTML
    text = text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .trim();
    
    if (text) {
      subtitles.push({
        start: start,
        dur: duration,
        text: text
      });
    }
  }
  
  return subtitles;
}

// Helper pour créer les réponses d'erreur
function createErrorResponse(statusCode, message, requestId, headers, extra = {}) {
  return {
    statusCode,
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      error: message,
      requestId,
      timestamp: new Date().toISOString(),
      ...extra
    })
  };
}

// Conversion des formats (identique à l'ancienne version)
function convertSubtitles(captions, format) {
  if (!captions || captions.length === 0) {
    return format === 'json' ? '[]' : '';
  }

  switch (format.toLowerCase()) {
    case 'srt': return convertToSrt(captions);
    case 'vtt': return convertToVtt(captions);
    case 'txt': return convertToTxt(captions);
    case 'json': return JSON.stringify(captions, null, 2);
    default: return convertToSrt(captions);
  }
}

function convertToSrt(captions) {
  return captions.map((caption, index) => {
    const start = formatSrtTime(caption.start);
    const end = formatSrtTime(caption.start + caption.dur);
    return `${index + 1}\n${start} --> ${end}\n${caption.text}\n`;
  }).join('\n');
}

function convertToVtt(captions) {
  const header = 'WEBVTT\n\n';
  const content = captions.map((caption, index) => {
    const start = formatVttTime(caption.start);
    const end = formatVttTime(caption.start + caption.dur);
    return `${index + 1}\n${start} --> ${end}\n${caption.text}\n`;
  }).join('\n');
  
  return header + content;
}

function convertToTxt(captions) {
  return captions
    .map(caption => caption.text)
    .filter(text => text && text.trim())
    .join(' ');
}

function formatSrtTime(seconds) {
  const totalMs = Math.round(Math.max(0, seconds) * 1000);
  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  const secs = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
}

function formatVttTime(seconds) {
  return formatSrtTime(seconds).replace(',', '.');
}

function getContentType(format) {
  const types = {
    'srt': 'application/x-subrip; charset=utf-8',
    'vtt': 'text/vtt; charset=utf-8', 
    'json': 'application/json; charset=utf-8',
    'txt': 'text/plain; charset=utf-8'
  };
  
  return types[format.toLowerCase()] || 'text/plain; charset=utf-8';
}