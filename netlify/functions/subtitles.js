// netlify/functions/subtitles.js - VERSION CORRIGÉE
const https = require('https');
const { URL } = require('url');

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-cache'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

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

  console.log(`Extraction pour: ${videoId}, format: ${format}, langue: ${language}`);

  try {
    // Méthode principale : scraping de la page YouTube
    const subtitles = await extractSubtitles(videoId, language);
    
    if (!subtitles || subtitles.length === 0) {
      return {
        statusCode: 404,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          error: 'Aucun sous-titre trouvé pour cette vidéo',
          videoId: videoId,
          language: language
        })
      };
    }

    const convertedContent = convertSubtitles(subtitles, format);
    
    console.log(`Succès: ${subtitles.length} segments pour ${videoId}`);

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
    console.error(`Erreur pour ${videoId}:`, error.message);
    
    return {
      statusCode: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Erreur lors de l\'extraction des sous-titres',
        details: error.message,
        videoId: videoId
      })
    };
  }
};

// Extraction des sous-titres
async function extractSubtitles(videoId, language) {
  console.log('Début extraction pour:', videoId);
  
  // 1. Récupérer la page YouTube
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}&hl=${language}`;
  const pageContent = await makeHttpRequest(watchUrl, {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept-Language': `${language},en;q=0.9`,
  });

  // 2. Extraire les informations des sous-titres
  const captionsData = extractCaptionsFromPage(pageContent);
  if (!captionsData) {
    throw new Error('Aucune information de sous-titres trouvée');
  }

  // 3. Trouver la meilleure URL de sous-titres
  const captionUrl = findBestCaptionUrl(captionsData, language);
  if (!captionUrl) {
    throw new Error(`Pas de sous-titres disponibles pour la langue: ${language}`);
  }

  console.log('URL sous-titres trouvée');

  // 4. Télécharger les sous-titres XML
  const xmlContent = await makeHttpRequest(captionUrl, {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  });

  // 5. Parser le XML
  return parseSubtitleXml(xmlContent);
}

function extractCaptionsFromPage(html) {
  // Chercher les données de sous-titres dans le JavaScript de la page
  const patterns = [
    /"captionTracks":\s*(\[.*?\])/,
    /"captions":\s*{[^}]*"captionTracks":\s*(\[.*?\])/,
    /ytInitialPlayerResponse["\s]*=["\s]*{.*?"captions":\s*{[^}]*"captionTracks":\s*(\[.*?\])/
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      try {
        return JSON.parse(match[1]);
      } catch (e) {
        console.log('Erreur parsing pattern:', e.message);
        continue;
      }
    }
  }

  return null;
}

function findBestCaptionUrl(captions, language) {
  if (!captions || captions.length === 0) return null;

  console.log('Langues disponibles:', captions.map(c => c.languageCode || 'unknown'));

  // Priorité 1: Langue exacte, sous-titres manuels
  let caption = captions.find(c => 
    (c.languageCode === language) && c.kind !== 'asr'
  );

  // Priorité 2: Langue exacte, même auto-générés
  if (!caption) {
    caption = captions.find(c => c.languageCode === language);
  }

  // Priorité 3: Langue avec région (ex: fr-FR pour fr)
  if (!caption) {
    caption = captions.find(c => 
      c.languageCode && c.languageCode.startsWith(language)
    );
  }

  // Priorité 4: Anglais comme fallback
  if (!caption) {
    caption = captions.find(c => 
      c.languageCode && c.languageCode.startsWith('en')
    );
  }

  // Priorité 5: Premier disponible
  if (!caption) {
    caption = captions[0];
  }

  if (!caption || !caption.baseUrl) return null;

  // Construire l'URL avec le bon format
  const url = new URL(caption.baseUrl);
  url.searchParams.delete('fmt'); // Supprimer l'ancien format
  url.searchParams.set('fmt', 'srv3'); // Format lisible
  
  return url.toString();
}

function parseSubtitleXml(xmlContent) {
  console.log(`Parsing XML (${xmlContent.length} chars)`);
  
  const subtitles = [];
  
  // Pattern pour extraire les segments de sous-titres
  const textPattern = /<text\s+start="([^"]*)"(?:\s+dur="([^"]*)")?[^>]*>(.*?)<\/text>/gs;
  
  let match;
  while ((match = textPattern.exec(xmlContent)) !== null) {
    const start = parseFloat(match[1]);
    const duration = parseFloat(match[2]) || 4.0;
    let text = match[3];
    
    // Nettoyer le texte
    text = text
      .replace(/<[^>]*>/g, '') // Supprimer les balises HTML
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    if (text && text.length > 0 && !isNaN(start)) {
      subtitles.push({
        start: start,
        duration: duration,
        end: start + duration,
        text: text
      });
    }
  }
  
  // Si pas de résultats, essayer un pattern plus simple
  if (subtitles.length === 0) {
    console.log('Tentative pattern alternatif...');
    const altPattern = /<text[^>]*start="([^"]*)"[^>]*>([^<]*)/gi;
    
    while ((match = altPattern.exec(xmlContent)) !== null) {
      const start = parseFloat(match[1]);
      const text = match[2].trim();
      
      if (text && !isNaN(start)) {
        subtitles.push({
          start: start,
          duration: 4.0,
          end: start + 4.0,
          text: text
        });
      }
    }
  }

  console.log(`Extracted ${subtitles.length} subtitle segments`);
  return subtitles;
}

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

function makeHttpRequest(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 443,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Encoding': 'identity',
        'Connection': 'close',
        ...headers
      },
      timeout: 30000
    };

    const req = https.request(options, (res) => {
      let data = '';
      
      // Gérer les redirections
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(makeHttpRequest(res.headers.location, headers));
      }
      
      res.setEncoding('utf8');
      res.on('data', chunk => data += chunk);
      
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
        }
      });
    });

    req.on('error', error => {
      reject(new Error(`Request error: ${error.message}`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.end();
  });
}