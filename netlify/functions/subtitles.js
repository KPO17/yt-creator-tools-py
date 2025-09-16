// netlify/functions/subtitles.js
// Version JavaScript pure avec Innertube API - Plus fiable que Python

const https = require('https');
const { URL } = require('url');

exports.handler = async (event, context) => {
  // Headers CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-cache'
  };

  // Gérer les requêtes OPTIONS (preflight)
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  // Seules les requêtes POST sont acceptées
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Méthode non autorisée' })
    };
  }

  let requestData;
  try {
    requestData = JSON.parse(event.body || '{}');
  } catch (parseError) {
    return {
      statusCode: 400,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'JSON invalide' })
    };
  }

  const { videoId, format = 'srt', language = 'fr' } = requestData;

  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return {
      statusCode: 400,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'ID vidéo YouTube invalide' })
    };
  }

  console.log(`[${new Date().toISOString()}] Extraction sous-titres: ${videoId}, format: ${format}, langue: ${language}`);

  try {
    // 1. Récupérer les métadonnées vidéo via Innertube
    const videoData = await getVideoData(videoId);
    
    if (!videoData || !videoData.captions) {
      return {
        statusCode: 404,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          error: 'Aucun sous-titre disponible pour cette vidéo',
          videoId: videoId
        })
      };
    }

    // 2. Trouver l'URL des sous-titres dans la langue demandée
    const captionUrl = findCaptionUrl(videoData.captions, language);
    
    if (!captionUrl) {
      return {
        statusCode: 404,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          error: `Sous-titres non disponibles en ${language}`,
          availableLanguages: getAvailableLanguages(videoData.captions),
          videoId: videoId
        })
      };
    }

    // 3. Télécharger le contenu des sous-titres
    const subtitleXml = await downloadSubtitles(captionUrl);
    
    // 4. Parser le XML et convertir au format demandé
    const parsedSubtitles = parseSubtitleXml(subtitleXml);
    
    if (!parsedSubtitles || parsedSubtitles.length === 0) {
      return {
        statusCode: 404,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          error: 'Impossible de parser les sous-titres',
          videoId: videoId
        })
      };
    }

    // 5. Convertir au format final
    const convertedContent = convertSubtitles(parsedSubtitles, format);
    
    console.log(`[${new Date().toISOString()}] Succès: ${parsedSubtitles.length} segments extraits pour ${videoId}`);

    // 6. Retourner le contenu
    return {
      statusCode: 200,
      headers: {
        ...headers,
        'Content-Type': getContentType(format),
        'Content-Disposition': `attachment; filename="${videoId}_subtitles.${format}"`
      },
      body: convertedContent
    };

  } catch (error) {
    console.error(`[${new Date().toISOString()}] Erreur extraction ${videoId}:`, error.message);
    
    return {
      statusCode: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Erreur lors de l\'extraction des sous-titres',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
        videoId: videoId
      })
    };
  }
};

// ==================== FONCTIONS INNERTUBE API ====================

/**
 * Récupère les métadonnées vidéo via l'API Innertube
 */
async function getVideoData(videoId) {
  const client = {
    clientName: "WEB",
    clientVersion: "2.20231219.04.00"
  };

  const payload = {
    context: {
      client: client
    },
    videoId: videoId
  };

  const response = await makeHttpRequest(
    'https://www.youtube.com/youtubei/v1/player',
    'POST',
    payload,
    {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  );

  const data = JSON.parse(response);
  
  if (!data.videoDetails) {
    throw new Error('Vidéo non trouvée ou privée');
  }

  return {
    title: data.videoDetails.title,
    captions: data.captions?.playerCaptionsTracklistRenderer?.captionTracks || []
  };
}

/**
 * Trouve l'URL des sous-titres pour la langue spécifiée
 */
function findCaptionUrl(captions, language) {
  if (!captions || captions.length === 0) {
    return null;
  }

  // Essayer de trouver la langue exacte
  let caption = captions.find(c => 
    c.languageCode === language || 
    c.languageCode?.startsWith(language)
  );

  // Fallback : première langue disponible
  if (!caption) {
    caption = captions.find(c => c.kind !== 'asr') || captions[0];
  }

  if (!caption || !caption.baseUrl) {
    return null;
  }

  // Ajouter le paramètre format=xml3 pour avoir le XML complet
  const url = new URL(caption.baseUrl);
  url.searchParams.set('format', 'xml3');
  
  return url.toString();
}

/**
 * Liste les langues disponibles
 */
function getAvailableLanguages(captions) {
  if (!captions || captions.length === 0) {
    return [];
  }

  return captions.map(caption => ({
    code: caption.languageCode,
    name: caption.name?.simpleText || caption.languageCode,
    auto: caption.kind === 'asr'
  }));
}

/**
 * Télécharge le contenu des sous-titres
 */
async function downloadSubtitles(url) {
  console.log(`Téléchargement sous-titres: ${url}`);
  
  return makeHttpRequest(url, 'GET', null, {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  });
}

/**
 * Parse le XML des sous-titres YouTube
 */
function parseSubtitleXml(xmlContent) {
  const subtitles = [];
  
  // Expression régulière pour extraire les balises <text>
  const textRegex = /<text start="([^"]*)"(?:\s+dur="([^"]*)")?>([^<]*)</g;
  
  let match;
  while ((match = textRegex.exec(xmlContent)) !== null) {
    const start = parseFloat(match[1]);
    const duration = parseFloat(match[2]) || 3.0; // Durée par défaut
    const text = decodeHtmlEntities(match[3].trim());
    
    if (text && text.length > 0) {
      subtitles.push({
        start: start,
        duration: duration,
        end: start + duration,
        text: text
      });
    }
  }
  
  return subtitles;
}

/**
 * Décode les entités HTML
 */
function decodeHtmlEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ==================== CONVERSION DE FORMATS ====================

/**
 * Convertit les sous-titres au format demandé
 */
function convertSubtitles(subtitles, format) {
  switch (format.toLowerCase()) {
    case 'srt':
      return convertToSrt(subtitles);
    case 'vtt':
      return convertToVtt(subtitles);
    case 'txt':
      return convertToTxt(subtitles);
    case 'json':
      return JSON.stringify(subtitles, null, 2);
    default:
      return convertToSrt(subtitles);
  }
}

/**
 * Convertit au format SRT
 */
function convertToSrt(subtitles) {
  return subtitles.map((entry, index) => {
    const start = formatSrtTime(entry.start);
    const end = formatSrtTime(entry.end);
    return `${index + 1}\n${start} --> ${end}\n${entry.text}\n`;
  }).join('\n');
}

/**
 * Convertit au format VTT (WebVTT)
 */
function convertToVtt(subtitles) {
  const header = 'WEBVTT\n\n';
  const content = subtitles.map((entry, index) => {
    const start = formatVttTime(entry.start);
    const end = formatVttTime(entry.end);
    return `${index + 1}\n${start} --> ${end}\n${entry.text}\n`;
  }).join('\n');
  
  return header + content;
}

/**
 * Convertit au format TXT (texte brut)
 */
function convertToTxt(subtitles) {
  return subtitles.map(entry => entry.text).join('\n');
}

/**
 * Formate le temps pour SRT (format: 00:00:00,000)
 */
function formatSrtTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
}

/**
 * Formate le temps pour VTT (format: 00:00:00.000)
 */
function formatVttTime(seconds) {
  return formatSrtTime(seconds).replace(',', '.');
}

/**
 * Détermine le type de contenu selon le format
 */
function getContentType(format) {
  switch (format.toLowerCase()) {
    case 'srt':
      return 'application/x-subrip; charset=utf-8';
    case 'vtt':
      return 'text/vtt; charset=utf-8';
    case 'json':
      return 'application/json; charset=utf-8';
    default:
      return 'text/plain; charset=utf-8';
  }
}

// ==================== UTILITAIRES HTTP ====================

/**
 * Effectue une requête HTTP
 */
function makeHttpRequest(url, method = 'GET', data = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: method,
      headers: {
        'Accept': '*/*',
        'Accept-Encoding': 'identity',
        'Connection': 'close',
        ...headers
      },
      timeout: 30000 // 30 secondes
    };

    if (data && method !== 'GET') {
      const payload = typeof data === 'string' ? data : JSON.stringify(data);
      options.headers['Content-Length'] = Buffer.byteLength(payload);
      
      if (!options.headers['Content-Type']) {
        options.headers['Content-Type'] = 'application/json';
      }
    }

    const req = https.request(options, (res) => {
      let responseData = '';
      
      res.setEncoding('utf8');
      res.on('data', (chunk) => responseData += chunk);
      
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(responseData);
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(new Error(`Erreur requête: ${error.message}`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout de la requête'));
    });

    // Envoyer les données si POST/PUT
    if (data && method !== 'GET') {
      const payload = typeof data === 'string' ? data : JSON.stringify(data);
      req.write(payload);
    }

    req.end();
  });
}