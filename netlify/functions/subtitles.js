// netlify/functions/subtitles.js
// Version améliorée avec meilleure gestion d'erreurs et méthodes alternatives

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
    return { statusCode: 200, headers, body: '' };
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
    console.error('Erreur parsing JSON:', parseError);
    return {
      statusCode: 400,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'JSON invalide' })
    };
  }

  const { videoId, format = 'srt', language = 'fr' } = requestData;

  // Validation de l'ID vidéo
  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return {
      statusCode: 400,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'ID vidéo YouTube invalide' })
    };
  }

  console.log(`[${new Date().toISOString()}] Début extraction: ${videoId}, format: ${format}, langue: ${language}`);

  try {
    // Essayer plusieurs méthodes successivement
    let subtitles = null;
    let method = 'unknown';

    // Méthode 1: API YouTube Data v3 (nécessite clé API)
    try {
      subtitles = await extractWithYouTubeAPI(videoId, language);
      method = 'youtube-api';
      console.log('Méthode YouTube API réussie');
    } catch (apiError) {
      console.log('YouTube API échouée:', apiError.message);
    }

    // Méthode 2: Scraping direct (plus fiable)
    if (!subtitles) {
      try {
        subtitles = await extractWithScraping(videoId, language);
        method = 'scraping';
        console.log('Méthode scraping réussie');
      } catch (scrapingError) {
        console.log('Scraping échoué:', scrapingError.message);
      }
    }

    // Méthode 3: Innertube (fallback)
    if (!subtitles) {
      try {
        subtitles = await extractWithInnertube(videoId, language);
        method = 'innertube';
        console.log('Méthode Innertube réussie');
      } catch (innertubeError) {
        console.log('Innertube échoué:', innertubeError.message);
      }
    }

    if (!subtitles || subtitles.length === 0) {
      return {
        statusCode: 404,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          error: 'Aucun sous-titre trouvé pour cette vidéo',
          videoId: videoId,
          language: language,
          debug: 'Toutes les méthodes d\'extraction ont échoué'
        })
      };
    }

    // Convertir au format demandé
    const convertedContent = convertSubtitles(subtitles, format);
    
    console.log(`[${new Date().toISOString()}] Succès (${method}): ${subtitles.length} segments pour ${videoId}`);

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
    console.error(`[${new Date().toISOString()}] Erreur critique pour ${videoId}:`, error);
    
    return {
      statusCode: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Erreur lors de l\'extraction des sous-titres',
        details: error.message,
        videoId: videoId,
        timestamp: new Date().toISOString()
      })
    };
  }
};

// ==================== MÉTHODE 1: SCRAPING DIRECT ====================

async function extractWithScraping(videoId, language) {
  console.log('Tentative scraping pour:', videoId);
  
  // Récupérer la page YouTube
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const pageContent = await makeHttpRequest(watchUrl, 'GET', null, {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'fr-FR,fr;q=0.8,en-US;q=0.5,en;q=0.3',
    'Accept-Encoding': 'identity'
  });

  // Extraire les informations de sous-titres depuis le JavaScript de la page
  const captionsRegex = /"captionTracks":\s*(\[.*?\])/;
  const match = pageContent.match(captionsRegex);
  
  if (!match) {
    throw new Error('Aucune information de sous-titres trouvée dans la page');
  }

  let captions;
  try {
    captions = JSON.parse(match[1]);
  } catch (parseError) {
    throw new Error('Impossible de parser les informations de sous-titres');
  }

  // Trouver l'URL des sous-titres
  const captionUrl = findBestCaptionUrl(captions, language);
  if (!captionUrl) {
    throw new Error(`Pas de sous-titres disponibles en ${language}`);
  }

  // Télécharger et parser les sous-titres
  const xmlContent = await downloadSubtitles(captionUrl);
  return parseSubtitleXml(xmlContent);
}

// ==================== MÉTHODE 2: YOUTUBE API V3 ====================

async function extractWithYouTubeAPI(videoId, language) {
  // Cette méthode nécessiterait une clé API YouTube
  // Pour l'instant, on la désactive
  throw new Error('YouTube API v3 non configurée');
}

// ==================== MÉTHODE 3: INNERTUBE (AMÉLIORÉE) ====================

async function extractWithInnertube(videoId, language) {
  console.log('Tentative Innertube pour:', videoId);
  
  const clientData = {
    context: {
      client: {
        clientName: "WEB",
        clientVersion: "2.20240101.09.00"
      },
      user: {
        lockedSafetyMode: false
      }
    },
    videoId: videoId
  };

  try {
    const response = await makeHttpRequest(
      'https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8',
      'POST',
      clientData,
      {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*',
        'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
        'Referer': 'https://www.youtube.com/'
      }
    );

    const data = JSON.parse(response);
    
    if (!data.videoDetails) {
      throw new Error('Vidéo non accessible via Innertube');
    }

    const captions = data.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!captions || captions.length === 0) {
      throw new Error('Aucun sous-titre trouvé via Innertube');
    }

    const captionUrl = findBestCaptionUrl(captions, language);
    if (!captionUrl) {
      throw new Error(`Pas de sous-titres ${language} via Innertube`);
    }

    const xmlContent = await downloadSubtitles(captionUrl);
    return parseSubtitleXml(xmlContent);

  } catch (error) {
    throw new Error(`Innertube failed: ${error.message}`);
  }
}

// ==================== UTILITAIRES AMÉLIORÉS ====================

function findBestCaptionUrl(captions, language) {
  if (!captions || captions.length === 0) return null;

  console.log('Langues disponibles:', captions.map(c => c.languageCode || 'inconnu'));

  // 1. Chercher la langue exacte (non auto-générée)
  let caption = captions.find(c => 
    (c.languageCode === language || c.languageCode?.startsWith(language)) && 
    c.kind !== 'asr'
  );

  // 2. Chercher la langue exacte (même auto-générée)
  if (!caption) {
    caption = captions.find(c => 
      c.languageCode === language || c.languageCode?.startsWith(language)
    );
  }

  // 3. Chercher l'anglais comme fallback
  if (!caption) {
    caption = captions.find(c => 
      c.languageCode?.startsWith('en') && c.kind !== 'asr'
    );
  }

  // 4. Prendre le premier disponible
  if (!caption) {
    caption = captions[0];
  }

  if (!caption?.baseUrl) return null;

  // Construire l'URL avec format XML
  const url = new URL(caption.baseUrl);
  url.searchParams.set('format', 'xml3');
  url.searchParams.set('fmt', 'xml3');
  
  return url.toString();
}

async function downloadSubtitles(url) {
  console.log(`Téléchargement: ${url.substring(0, 100)}...`);
  
  return makeHttpRequest(url, 'GET', null, {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/xml, text/xml, */*',
    'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8'
  });
}

function parseSubtitleXml(xmlContent) {
  console.log(`Parsing XML (${xmlContent.length} caractères)`);
  
  const subtitles = [];
  
  // Méthode 1: Regex améliorée pour <text>
  const textRegex = /<text\s+start="([^"]*)"(?:\s+dur="([^"]*)")?[^>]*>([^<]*)<\/text>/gi;
  
  let match;
  while ((match = textRegex.exec(xmlContent)) !== null) {
    const start = parseFloat(match[1]);
    const duration = parseFloat(match[2]) || 3.0;
    const text = decodeHtmlEntities(match[3]);
    
    if (text && text.trim().length > 0 && !isNaN(start)) {
      subtitles.push({
        start: start,
        duration: duration,
        end: start + duration,
        text: text.trim()
      });
    }
  }

  // Méthode 2: Si la première a échoué, essayer une regex plus simple
  if (subtitles.length === 0) {
    console.log('Tentative parsing alternatif...');
    const altRegex = /<text[^>]*start="([^"]*)"[^>]*>([^<]*)/gi;
    
    while ((match = altRegex.exec(xmlContent)) !== null) {
      const start = parseFloat(match[1]);
      const text = decodeHtmlEntities(match[2]);
      
      if (text && text.trim().length > 0 && !isNaN(start)) {
        subtitles.push({
          start: start,
          duration: 3.0,
          end: start + 3.0,
          text: text.trim()
        });
      }
    }
  }

  console.log(`Parsed ${subtitles.length} segments`);
  return subtitles;
}

function decodeHtmlEntities(text) {
  if (!text) return '';
  
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec))
    .replace(/&#x([0-9a-fA-F]+);/g, (match, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ==================== CONVERSION DE FORMATS ====================

function convertSubtitles(subtitles, format) {
  switch (format.toLowerCase()) {
    case 'srt': return convertToSrt(subtitles);
    case 'vtt': return convertToVtt(subtitles);
    case 'txt': return convertToTxt(subtitles);
    case 'json': return JSON.stringify(subtitles, null, 2);
    default: return convertToSrt(subtitles);
  }
}

function convertToSrt(subtitles) {
  return subtitles.map((entry, index) => {
    const start = formatSrtTime(entry.start);
    const end = formatSrtTime(entry.end);
    return `${index + 1}\n${start} --> ${end}\n${entry.text}\n`;
  }).join('\n');
}

function convertToVtt(subtitles) {
  const header = 'WEBVTT\n\n';
  const content = subtitles.map((entry, index) => {
    const start = formatVttTime(entry.start);
    const end = formatVttTime(entry.end);
    return `${index + 1}\n${start} --> ${end}\n${entry.text}\n`;
  }).join('\n');
  
  return header + content;
}

function convertToTxt(subtitles) {
  return subtitles.map(entry => entry.text).join('\n');
}

function formatSrtTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
}

function formatVttTime(seconds) {
  return formatSrtTime(seconds).replace(',', '.');
}

function getContentType(format) {
  switch (format.toLowerCase()) {
    case 'srt': return 'application/x-subrip; charset=utf-8';
    case 'vtt': return 'text/vtt; charset=utf-8';
    case 'json': return 'application/json; charset=utf-8';
    default: return 'text/plain; charset=utf-8';
  }
}

// ==================== HTTP AMÉLIORÉ ====================

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
      timeout: 60000 // 60 secondes au lieu de 30
    };

    // Préparer les données
    let payload = null;
    if (data && method !== 'GET') {
      payload = typeof data === 'string' ? data : JSON.stringify(data);
      options.headers['Content-Length'] = Buffer.byteLength(payload);
      
      if (!options.headers['Content-Type']) {
        options.headers['Content-Type'] = 'application/json';
      }
    }

    const req = https.request(options, (res) => {
      let responseData = '';
      
      // Gérer les redirections
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        console.log(`Redirection vers: ${res.headers.location}`);
        return resolve(makeHttpRequest(res.headers.location, method, data, headers));
      }
      
      res.setEncoding('utf8');
      res.on('data', (chunk) => responseData += chunk);
      
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(responseData);
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage || 'Erreur inconnue'}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(new Error(`Erreur réseau: ${error.message}`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout de la requête (60s)'));
    });

    // Envoyer les données
    if (payload) {
      req.write(payload);
    }

    req.end();
  });
}