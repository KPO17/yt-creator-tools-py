// netlify/functions/subtitles.js - VERSION AVEC DEBUGGING AMÉLIORÉ
const https = require('https');
const { URL } = require('url');

// Configuration globale avec logging amélioré
const CONFIG = {
  DEBUG: process.env.NODE_ENV !== 'production',
  MAX_REQUEST_SIZE: 10 * 1024 * 1024, // 10MB
  TIMEOUT: 25000, // 25s (Netlify a une limite de 30s)
  MAX_RETRIES: 2,
  USER_AGENTS: [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  ]
};

// Logger avec différents niveaux
function log(level, message, data = null) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
  
  console.log(logMessage);
  if (data && CONFIG.DEBUG) {
    console.log('Data:', JSON.stringify(data, null, 2).substring(0, 500));
  }
}

exports.handler = async (event, context) => {
  const startTime = Date.now();
  
  // Headers CORS obligatoires
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'X-Content-Type-Options': 'nosniff'
  };

  // Préflight CORS
  if (event.httpMethod === 'OPTIONS') {
    log('info', 'Preflight CORS request');
    return { statusCode: 200, headers, body: '' };
  }

  // Validation méthode HTTP
  if (event.httpMethod !== 'POST') {
    log('warn', `Méthode non supportée: ${event.httpMethod}`);
    return {
      statusCode: 405,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Méthode non autorisée',
        allowed: ['POST'],
        received: event.httpMethod 
      })
    };
  }

  let requestId = Math.random().toString(36).substring(7);
  log('info', `Nouvelle requête [${requestId}]`, { 
    method: event.httpMethod,
    bodySize: event.body?.length || 0 
  });

  // Parsing du body avec validation
  let requestData = {};
  try {
    if (!event.body) {
      throw new Error('Body vide');
    }
    
    requestData = JSON.parse(event.body);
    log('debug', `Body parsé [${requestId}]`, requestData);
    
  } catch (parseError) {
    log('error', `Erreur parsing JSON [${requestId}]`, parseError.message);
    return {
      statusCode: 400,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: 'JSON invalide',
        details: parseError.message,
        requestId
      })
    };
  }

  // Extraction et validation des paramètres
  const { videoId, format = 'srt', language = 'fr' } = requestData;

  // Validation stricte de l'ID vidéo YouTube
  if (!videoId) {
    log('warn', `VideoID manquant [${requestId}]`);
    return createErrorResponse(400, 'VideoID requis', requestId, headers);
  }

  if (typeof videoId !== 'string' || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    log('warn', `VideoID invalide [${requestId}]: ${videoId}`);
    return createErrorResponse(400, `ID vidéo YouTube invalide: "${videoId}"`, requestId, headers);
  }

  // Validation format
  const allowedFormats = ['srt', 'vtt', 'txt', 'json'];
  if (!allowedFormats.includes(format.toLowerCase())) {
    log('warn', `Format invalide [${requestId}]: ${format}`);
    return createErrorResponse(400, `Format non supporté: ${format}. Autorisés: ${allowedFormats.join(', ')}`, requestId, headers);
  }

  // Validation langue
  if (typeof language !== 'string' || language.length > 10) {
    log('warn', `Langue invalide [${requestId}]: ${language}`);
    return createErrorResponse(400, `Code langue invalide: ${language}`, requestId, headers);
  }

  log('info', `Démarrage extraction [${requestId}]`, { videoId, format, language });

  try {
    // Extraction des sous-titres avec gestion d'erreur robuste
    const subtitles = await extractSubtitlesWithRetry(videoId, language, requestId);
    
    if (!subtitles || subtitles.length === 0) {
      log('warn', `Aucun sous-titre trouvé [${requestId}]`);
      return createErrorResponse(404, 'Aucun sous-titre disponible pour cette vidéo', requestId, headers, {
        videoId,
        language,
        suggestions: [
          'Vérifiez que la vidéo existe',
          'Essayez avec language="auto" ou "en"',
          'Cette vidéo peut ne pas avoir de sous-titres'
        ]
      });
    }

    // Conversion au format demandé
    const convertedContent = convertSubtitles(subtitles, format);
    const duration = Date.now() - startTime;
    
    log('info', `Succès extraction [${requestId}]`, { 
      segments: subtitles.length,
      size: convertedContent.length,
      duration: `${duration}ms`
    });

    return {
      statusCode: 200,
      headers: {
        ...headers,
        'Content-Type': getContentType(format),
        'Content-Disposition': `attachment; filename="${videoId}_subtitles.${format}"`,
        'X-Request-ID': requestId,
        'X-Processing-Time': `${duration}ms`,
        'X-Segments-Count': subtitles.length.toString()
      },
      body: convertedContent
    };

  } catch (error) {
    const duration = Date.now() - startTime;
    log('error', `Erreur extraction [${requestId}]`, {
      message: error.message,
      stack: CONFIG.DEBUG ? error.stack : undefined,
      duration: `${duration}ms`
    });

    // Classification de l'erreur
    let statusCode = 500;
    let userMessage = 'Erreur interne du serveur';

    if (error.message.includes('timeout') || error.message.includes('TIMEOUT')) {
      statusCode = 408;
      userMessage = 'Délai d\'attente dépassé';
    } else if (error.message.includes('ENOTFOUND') || error.message.includes('getaddrinfo')) {
      statusCode = 503;
      userMessage = 'Service YouTube temporairement indisponible';
    } else if (error.message.includes('403') || error.message.includes('Forbidden')) {
      statusCode = 403;
      userMessage = 'Accès refusé par YouTube';
    } else if (error.message.includes('404') || error.message.includes('not found')) {
      statusCode = 404;
      userMessage = 'Vidéo non trouvée';
    }

    return createErrorResponse(statusCode, userMessage, requestId, headers, {
      technical: CONFIG.DEBUG ? error.message : 'Erreur technique masquée en production',
      duration: `${duration}ms`
    });
  }
};

// Fonction helper pour créer les réponses d'erreur
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

// Extraction avec retry et fallbacks
async function extractSubtitlesWithRetry(videoId, language, requestId, attempt = 1) {
  const maxAttempts = CONFIG.MAX_RETRIES + 1;
  
  try {
    log('info', `Tentative ${attempt}/${maxAttempts} [${requestId}]`);
    
    return await extractSubtitlesFromYoutube(videoId, language, requestId);
    
  } catch (error) {
    log('warn', `Échec tentative ${attempt} [${requestId}]: ${error.message}`);
    
    if (attempt < maxAttempts) {
      // Attendre avant de réessayer (backoff exponentiel)
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
      log('info', `Retry dans ${delay}ms [${requestId}]`);
      
      await new Promise(resolve => setTimeout(resolve, delay));
      return extractSubtitlesWithRetry(videoId, language, requestId, attempt + 1);
    }
    
    throw error;
  }
}

// Extraction principale avec timeout et logging détaillé
async function extractSubtitlesFromYoutube(videoId, language, requestId) {
  const steps = [];
  
  try {
    // Étape 1: Récupération de la page YouTube
    steps.push('fetch_page');
    log('debug', `Étape: récupération page [${requestId}]`);
    
    const watchUrl = `https://www.youtube.com/watch?v=${videoId}&hl=${language || 'en'}&gl=US`;
    const userAgent = CONFIG.USER_AGENTS[Math.floor(Math.random() * CONFIG.USER_AGENTS.length)];
    
    const pageHtml = await makeSecureHttpRequest(watchUrl, {
      'User-Agent': userAgent,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': `${language || 'en'}-US,${language || 'en'};q=0.5`,
      'Accept-Encoding': 'identity',
      'Cache-Control': 'no-cache',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Upgrade-Insecure-Requests': '1'
    }, CONFIG.TIMEOUT);

    if (!pageHtml || pageHtml.length < 5000) {
      throw new Error(`Page YouTube invalide ou vide (${pageHtml?.length || 0} chars)`);
    }

    log('debug', `Page récupérée [${requestId}]: ${pageHtml.length} chars`);

    // Étape 2: Extraction des données de sous-titres
    steps.push('extract_captions');
    log('debug', `Étape: extraction captions data [${requestId}]`);
    
    const captionsData = extractCaptionTracksFromHtml(pageHtml, requestId);
    
    if (!captionsData || captionsData.length === 0) {
      throw new Error('Aucune piste de sous-titres trouvée dans la page YouTube');
    }

    log('info', `${captionsData.length} pistes trouvées [${requestId}]`);

    // Étape 3: Sélection de la meilleure piste
    steps.push('select_track');
    const selectedTrack = selectBestCaptionTrack(captionsData, language, requestId);
    
    if (!selectedTrack) {
      const availableLangs = captionsData.map(t => t.languageCode || 'unknown').join(', ');
      throw new Error(`Aucune piste appropriée trouvée. Langues disponibles: ${availableLangs}`);
    }

    log('info', `Piste sélectionnée [${requestId}]: ${selectedTrack.languageCode} (${selectedTrack.kind || 'manual'})`);

    // Étape 4: Construction URL et téléchargement XML
    steps.push('download_xml');
    const xmlUrl = buildOptimalSubtitleUrl(selectedTrack.baseUrl);
    
    log('debug', `Téléchargement XML [${requestId}]`);
    
    const xmlContent = await makeSecureHttpRequest(xmlUrl, {
      'User-Agent': userAgent,
      'Accept': 'application/xml, text/xml, */*',
      'Accept-Language': `${language || 'en'}`,
      'Referer': 'https://www.youtube.com/',
      'Cache-Control': 'no-cache'
    }, CONFIG.TIMEOUT);

    if (!xmlContent || xmlContent.length < 100) {
      throw new Error(`XML sous-titres vide ou invalide (${xmlContent?.length || 0} chars)`);
    }

    // Étape 5: Parsing et nettoyage
    steps.push('parse_xml');
    log('debug', `Parsing XML [${requestId}]: ${xmlContent.length} chars`);
    
    const subtitles = parseAndCleanSubtitles(xmlContent, requestId);
    
    if (!subtitles || subtitles.length === 0) {
      throw new Error('Aucun segment de sous-titre extrait du XML');
    }

    log('info', `Extraction réussie [${requestId}]: ${subtitles.length} segments`);
    return subtitles;

  } catch (error) {
    const failedStep = steps[steps.length - 1] || 'unknown';
    const enhancedError = new Error(`Échec étape '${failedStep}': ${error.message}`);
    enhancedError.step = failedStep;
    enhancedError.steps = steps;
    throw enhancedError;
  }
}

// Extraction robuste des données de captions avec multiples patterns
function extractCaptionTracksFromHtml(html, requestId) {
  const patterns = [
    // Pattern principal ytInitialPlayerResponse
    {
      name: 'ytInitialPlayerResponse_main',
      regex: /ytInitialPlayerResponse\s*=\s*({.+?});(?:\s*var|\s*window|\s*if|\s*<)/s
    },
    // Pattern dans window
    {
      name: 'window_ytInitialPlayerResponse', 
      regex: /window\["ytInitialPlayerResponse"\]\s*=\s*({.+?});/s
    },
    // Pattern direct captionTracks
    {
      name: 'direct_captionTracks',
      regex: /"captionTracks":\s*(\[[^\]]+\])/s
    },
    // Pattern dans playerCaptionsTracklistRenderer
    {
      name: 'tracklistRenderer',
      regex: /"playerCaptionsTracklistRenderer":\s*{[^}]*"captionTracks":\s*(\[.+?\])/s
    }
  ];

  for (const pattern of patterns) {
    try {
      const match = html.match(pattern.regex);
      if (match) {
        log('debug', `Pattern trouvé [${requestId}]: ${pattern.name}`);
        
        let data;
        if (pattern.name === 'direct_captionTracks' || pattern.name === 'tracklistRenderer') {
          data = JSON.parse(match[1]);
        } else {
          const parsed = JSON.parse(match[1]);
          data = parsed?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        }
        
        if (data && Array.isArray(data) && data.length > 0) {
          log('info', `${data.length} pistes extraites via ${pattern.name} [${requestId}]`);
          return data;
        }
      }
    } catch (parseError) {
      log('debug', `Erreur pattern ${pattern.name} [${requestId}]: ${parseError.message}`);
      continue;
    }
  }

  log('warn', `Aucun pattern de caption trouvé [${requestId}]`);
  return [];
}

// Sélection optimisée de la piste avec logging
function selectBestCaptionTrack(tracks, requestedLanguage, requestId) {
  if (!tracks || tracks.length === 0) return null;

  const lang = requestedLanguage || 'en';
  const available = tracks.map(t => `${t.languageCode}(${t.kind || 'manual'})`).join(', ');
  log('debug', `Sélection piste [${requestId}] - Demandé: ${lang}, Disponible: ${available}`);

  // Priorités avec logging
  const priorities = [
    { name: 'exact_manual', fn: t => t.languageCode === lang && (!t.kind || t.kind !== 'asr') },
    { name: 'exact_any', fn: t => t.languageCode === lang },
    { name: 'regional_variant', fn: t => t.languageCode && t.languageCode.startsWith(lang + '-') },
    { name: 'language_prefix', fn: t => t.languageCode && t.languageCode.startsWith(lang) },
    { name: 'english_fallback', fn: t => lang !== 'en' && t.languageCode && (t.languageCode === 'en' || t.languageCode.startsWith('en-')) },
    { name: 'first_available', fn: () => true }
  ];

  for (const priority of priorities) {
    const track = tracks.find(priority.fn);
    if (track) {
      log('info', `Piste sélectionnée [${requestId}]: ${track.languageCode} via ${priority.name}`);
      return track;
    }
  }

  return null;
}

// Construction d'URL optimisée
function buildOptimalSubtitleUrl(baseUrl) {
  if (!baseUrl) throw new Error('URL de base manquante pour les sous-titres');

  try {
    const url = new URL(baseUrl);
    
    // Paramètres optimaux testés
    url.searchParams.set('fmt', 'srv3');
    url.searchParams.delete('tlang');
    url.searchParams.delete('kind');
    url.searchParams.delete('v'); // Éviter les conflits de version
    
    return url.toString();
  } catch (error) {
    throw new Error(`URL de sous-titres invalide: ${error.message}`);
  }
}

// Parsing XML avec validation et nettoyage renforcés
function parseAndCleanSubtitles(xmlString, requestId) {
  const subtitles = [];
  
  if (!xmlString || typeof xmlString !== 'string') {
    throw new Error('XML des sous-titres vide ou invalide');
  }

  // Nettoyage préliminaire du XML
  const cleanXml = xmlString
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();

  // Pattern robuste pour les éléments <text>
  const textRegex = /<text\s+start="([^"]+)"(?:\s+dur="([^"]+)")?[^>]*>(.*?)<\/text>/gs;
  
  let match;
  let segmentCount = 0;
  const maxSegments = 5000; // Limite de sécurité
  
  while ((match = textRegex.exec(cleanXml)) !== null && segmentCount < maxSegments) {
    try {
      const startTime = parseFloat(match[1]);
      const duration = parseFloat(match[2]) || 3.0;
      let textContent = match[3];
      
      // Validation stricte des timings
      if (isNaN(startTime) || startTime < 0 || startTime > 86400) { // Max 24h
        continue;
      }
      
      if (isNaN(duration) || duration <= 0 || duration > 30) { // Max 30s par segment
        continue;
      }

      // Nettoyage du texte
      textContent = cleanAndValidateText(textContent);
      
      if (textContent && textContent.length > 0 && textContent.length < 1000) {
        subtitles.push({
          start: Math.max(0, startTime),
          duration: Math.min(30, Math.max(0.5, duration)),
          end: Math.max(0.5, startTime + duration),
          text: textContent,
          index: segmentCount
        });
        segmentCount++;
      }
      
    } catch (parseError) {
      log('debug', `Erreur parsing segment [${requestId}]: ${parseError.message}`);
      continue;
    }
  }

  log('debug', `${segmentCount} segments parsés [${requestId}]`);

  // Post-traitement: tri et fusion
  return postProcessSubtitles(subtitles, requestId);
}

// Nettoyage de texte renforcé
function cleanAndValidateText(rawText) {
  if (!rawText || typeof rawText !== 'string') return '';
  
  let cleaned = rawText
    // Supprimer balises HTML/XML
    .replace(/<[^>]*>/g, '')
    // Décoder entités HTML courantes
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&apos;/g, "'")
    // Décoder entités numériques
    .replace(/&#(\d+);/g, (match, code) => {
      try {
        const num = parseInt(code);
        return (num > 31 && num < 127) ? String.fromCharCode(num) : ' ';
      } catch { return ' '; }
    })
    // Nettoyer espaces et caractères de contrôle
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Validation finale
  if (cleaned.length < 1 || cleaned.length > 500) return '';
  if (/^[\s\W]*$/.test(cleaned)) return '';
  
  return cleaned;
}

// Post-traitement avec consolidation intelligente
function postProcessSubtitles(subtitles, requestId) {
  if (!subtitles || subtitles.length === 0) return [];

  // Tri par temps de début
  subtitles.sort((a, b) => a.start - b.start);

  const processed = [];
  let current = null;

  for (const subtitle of subtitles) {
    if (!current) {
      current = { ...subtitle };
      continue;
    }

    const gap = subtitle.start - current.end;
    const canMerge = gap < 1.0 && 
                    current.text.length + subtitle.text.length < 400 &&
                    !current.text.endsWith('.') &&
                    !current.text.endsWith('!') &&
                    !current.text.endsWith('?');
    
    if (canMerge) {
      // Fusion intelligente
      const separator = gap > 0.2 ? ' ' : '';
      current.text += separator + subtitle.text;
      current.end = Math.max(current.end, subtitle.end);
      current.duration = current.end - current.start;
    } else {
      // Nouveau segment
      processed.push(current);
      current = { ...subtitle };
    }
  }

  if (current) {
    processed.push(current);
  }

  log('debug', `Post-traitement [${requestId}]: ${subtitles.length} -> ${processed.length} segments`);
  return processed;
}

// Conversion avec validation
function convertSubtitles(subtitles, format) {
  if (!subtitles || subtitles.length === 0) {
    return format === 'json' ? '[]' : '';
  }

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
  return subtitles
    .map(entry => entry.text)
    .filter(text => text && text.trim())
    .join('\n\n');
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

// Requête HTTP sécurisée avec retry et timeout strict
function makeSecureHttpRequest(url, headers = {}, timeout = 25000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    let finished = false;
    
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
        'DNT': '1',
        ...headers
      },
      timeout: timeout,
      rejectUnauthorized: true
    };

    const timeoutId = setTimeout(() => {
      if (!finished) {
        finished = true;
        reject(new Error(`TIMEOUT après ${timeout}ms pour ${url}`));
      }
    }, timeout);

    const req = https.request(options, (res) => {
      if (finished) return;
      
      // Gestion redirections
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        clearTimeout(timeoutId);
        return resolve(makeSecureHttpRequest(res.headers.location, headers, timeout));
      }

      if (res.statusCode < 200 || res.statusCode >= 400) {
        finished = true;
        clearTimeout(timeoutId);
        return reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage} for ${url}`));
      }

      let data = '';
      let size = 0;
      
      res.setEncoding('utf8');
      
      res.on('data', chunk => {
        if (finished) return;
        
        size += Buffer.byteLength(chunk, 'utf8');
        if (size > CONFIG.MAX_REQUEST_SIZE) {
          finished = true;
          clearTimeout(timeoutId);
          req.destroy();
          return reject(new Error(`Réponse trop volumineuse: ${size} bytes`));
        }
        
        data += chunk;
      });
      
      res.on('end', () => {
        if (finished) return;
        finished = true;
        clearTimeout(timeoutId);
        
        const duration = Date.now() - startTime;
        log('debug', `HTTP OK: ${url} (${duration}ms, ${data.length} chars)`);
        
        resolve(data);
      });

      res.on('error', error => {
        if (finished) return;
        finished = true;
        clearTimeout(timeoutId);
        reject(new Error(`Response error: ${error.message}`));
      });
    });

    req.on('error', error => {
      if (finished) return;
      finished = true;
      clearTimeout(timeoutId);
      reject(new Error(`Request error: ${error.message}`));
    });

    req.on('timeout', () => {
      if (finished) return;
      finished = true;
      clearTimeout(timeoutId);
      req.destroy();
      reject(new Error(`Request timeout après ${timeout}ms`));
    });

    req.end();
  });
}