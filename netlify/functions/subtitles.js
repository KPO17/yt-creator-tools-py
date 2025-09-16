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

  // Gestion CORS
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

  // Validation stricte de l'ID vidéo
  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return {
      statusCode: 400,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'ID vidéo YouTube invalide' })
    };
  }

  console.log(`Extraction pour: ${videoId}, format: ${format}, langue: ${language}`);

  try {
    const subtitles = await extractSubtitlesFromYoutube(videoId, language);
    
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
    
    console.log(`Succès: ${subtitles.length} segments extraits`);

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
    console.error(`Erreur extraction ${videoId}:`, error.message);
    
    return {
      statusCode: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Erreur lors de l\'extraction des sous-titres',
        details: process.env.NODE_ENV === 'development' ? error.message : 'Erreur interne',
        videoId: videoId
      })
    };
  }
};

// Nouvelle approche d'extraction plus robuste
async function extractSubtitlesFromYoutube(videoId, language) {
  console.log(`Début extraction pour ${videoId}, langue: ${language}`);
  
  try {
    // 1. Récupérer la page de la vidéo
    const watchUrl = `https://www.youtube.com/watch?v=${videoId}&hl=${language || 'en'}`;
    
    const pageHtml = await makeHttpsRequest(watchUrl, {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': `${language || 'en'},en;q=0.5`,
      'Accept-Encoding': 'identity',
      'Cache-Control': 'no-cache',
      'Upgrade-Insecure-Requests': '1'
    });

    if (!pageHtml || pageHtml.length < 1000) {
      throw new Error('Page YouTube non accessible ou vide');
    }

    // 2. Extraire les données de configuration des sous-titres
    const captionsData = extractCaptionTracksFromHtml(pageHtml);
    
    if (!captionsData || captionsData.length === 0) {
      throw new Error('Aucune piste de sous-titres trouvée dans la page');
    }

    console.log(`Trouvé ${captionsData.length} pistes de sous-titres`);

    // 3. Sélectionner la meilleure piste
    const selectedTrack = selectBestCaptionTrack(captionsData, language);
    
    if (!selectedTrack) {
      const availableLangs = captionsData.map(t => t.languageCode).join(', ');
      throw new Error(`Aucune piste appropriée pour "${language}". Disponibles: ${availableLangs}`);
    }

    console.log(`Piste sélectionnée: ${selectedTrack.languageCode} (${selectedTrack.kind || 'manual'})`);

    // 4. Télécharger les sous-titres au format XML
    const xmlUrl = buildSubtitleUrl(selectedTrack.baseUrl);
    const xmlContent = await makeHttpsRequest(xmlUrl, {
      'User-Agent': 'Mozilla/5.0 (compatible; SubtitleBot/1.0)',
      'Accept': 'application/xml, text/xml, */*',
      'Referer': 'https://www.youtube.com/'
    });

    if (!xmlContent || xmlContent.length < 50) {
      throw new Error('Contenu XML des sous-titres vide ou invalide');
    }

    // 5. Parser le XML et extraire les segments
    const subtitles = parseYouTubeXmlSubtitles(xmlContent);
    
    if (!subtitles || subtitles.length === 0) {
      throw new Error('Aucun segment de sous-titre extrait du XML');
    }

    console.log(`${subtitles.length} segments extraits avec succès`);
    return subtitles;

  } catch (error) {
    console.error('Erreur dans extractSubtitlesFromYoutube:', error.message);
    throw error;
  }
}

// Extraction améliorée des pistes de sous-titres
function extractCaptionTracksFromHtml(html) {
  const patterns = [
    // Pattern principal pour ytInitialPlayerResponse
    /ytInitialPlayerResponse\s*=\s*({.+?});/s,
    // Pattern alternatif
    /var\s+ytInitialPlayerResponse\s*=\s*({.+?});/s,
    // Pattern dans les scripts
    /"captions":\s*{[^}]*"playerCaptionsTracklistRenderer":\s*{[^}]*"captionTracks":\s*(\[.+?\])/s
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      try {
        if (match[1].startsWith('[')) {
          // Directement un array de pistes
          return JSON.parse(match[1]);
        } else {
          // Objet complet ytInitialPlayerResponse
          const playerResponse = JSON.parse(match[1]);
          
          const captions = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
          if (captions && Array.isArray(captions)) {
            return captions;
          }
        }
      } catch (parseError) {
        console.log(`Erreur parsing pattern: ${parseError.message}`);
        continue;
      }
    }
  }

  // Méthode de fallback: recherche plus générale
  const fallbackMatch = html.match(/"captionTracks":\s*(\[[^\]]+\])/);
  if (fallbackMatch) {
    try {
      return JSON.parse(fallbackMatch[1]);
    } catch (e) {
      console.log('Erreur fallback parsing:', e.message);
    }
  }

  return [];
}

// Sélection intelligente de la meilleure piste
function selectBestCaptionTrack(tracks, requestedLanguage) {
  if (!tracks || tracks.length === 0) return null;

  const lang = requestedLanguage || 'en';
  console.log(`Langues disponibles: ${tracks.map(t => `${t.languageCode}(${t.kind || 'manual'})`).join(', ')}`);

  // Priorité 1: Langue exacte + sous-titres manuels
  let track = tracks.find(t => 
    t.languageCode === lang && (!t.kind || t.kind !== 'asr')
  );

  // Priorité 2: Langue exacte (même auto-générés)
  if (!track) {
    track = tracks.find(t => t.languageCode === lang);
  }

  // Priorité 3: Langue avec variante régionale (ex: en-US pour en)
  if (!track) {
    track = tracks.find(t => 
      t.languageCode && t.languageCode.startsWith(lang + '-')
    );
  }

  // Priorité 4: Préfixe de langue (ex: fr-CA pour fr)
  if (!track) {
    track = tracks.find(t => 
      t.languageCode && t.languageCode.startsWith(lang)
    );
  }

  // Priorité 5: Anglais comme fallback universel
  if (!track && lang !== 'en') {
    track = tracks.find(t => 
      t.languageCode && (t.languageCode === 'en' || t.languageCode.startsWith('en-'))
    );
  }

  // Priorité 6: Première piste disponible
  if (!track) {
    track = tracks[0];
  }

  return track;
}

// Construction de l'URL des sous-titres avec les bons paramètres
function buildSubtitleUrl(baseUrl) {
  if (!baseUrl) throw new Error('URL de base manquante');

  try {
    const url = new URL(baseUrl);
    
    // Paramètres optimaux pour l'extraction
    url.searchParams.set('fmt', 'srv3'); // Format de service le plus compatible
    url.searchParams.set('tlang', ''); // Pas de traduction
    url.searchParams.delete('kind'); // Supprimer restrictions
    
    return url.toString();
  } catch (error) {
    throw new Error(`URL invalide: ${error.message}`);
  }
}

// Parser XML YouTube amélioré
function parseYouTubeXmlSubtitles(xmlString) {
  const subtitles = [];
  
  // Nettoyer le XML au préalable
  const cleanXml = xmlString
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

  // Pattern principal pour les éléments <text>
  const textRegex = /<text\s+start="([^"]+)"(?:\s+dur="([^"]+)")?[^>]*>(.*?)<\/text>/gs;
  
  let match;
  let index = 0;
  
  while ((match = textRegex.exec(cleanXml)) !== null && index < 10000) { // Limite de sécurité
    try {
      const startTime = parseFloat(match[1]);
      const duration = parseFloat(match[2]) || 3.0;
      let textContent = match[3];
      
      // Validation du timing
      if (isNaN(startTime) || startTime < 0) {
        console.warn(`Timing invalide ignoré: ${match[1]}`);
        continue;
      }

      // Nettoyage approfondi du texte
      textContent = cleanSubtitleText(textContent);
      
      if (textContent && textContent.length > 0) {
        subtitles.push({
          start: Math.max(0, startTime),
          duration: Math.max(0.5, duration),
          end: Math.max(0.5, startTime + duration),
          text: textContent,
          index: index++
        });
      }
    } catch (parseError) {
      console.warn(`Erreur parsing segment: ${parseError.message}`);
      continue;
    }
  }

  // Tri par temps de début et fusion des segments proches
  return consolidateSubtitles(subtitles);
}

// Nettoyage approfondi du texte des sous-titres
function cleanSubtitleText(rawText) {
  if (!rawText) return '';
  
  return rawText
    // Supprimer balises HTML/XML
    .replace(/<[^>]*>/g, '')
    // Décoder entités HTML
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (match, code) => String.fromCharCode(parseInt(code)))
    // Nettoyer espaces et sauts de ligne
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\s+|\s+$/g, '')
    // Supprimer caractères de contrôle
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '');
}

// Consolidation et fusion intelligente des segments
function consolidateSubtitles(subtitles) {
  if (!subtitles || subtitles.length === 0) return [];

  // Tri par temps de début
  subtitles.sort((a, b) => a.start - b.start);

  const consolidated = [];
  let current = null;

  for (const subtitle of subtitles) {
    if (!current) {
      current = { ...subtitle };
      continue;
    }

    // Fusionner si les segments se chevauchent ou sont très proches (< 0.5s)
    const gap = subtitle.start - current.end;
    
    if (gap < 0.5 && current.text.length + subtitle.text.length < 200) {
      // Fusion
      current.text += (gap > 0 ? ' ' : '') + subtitle.text;
      current.end = Math.max(current.end, subtitle.end);
      current.duration = current.end - current.start;
    } else {
      // Nouveau segment
      consolidated.push(current);
      current = { ...subtitle };
    }
  }

  // Ajouter le dernier segment
  if (current) {
    consolidated.push(current);
  }

  return consolidated;
}

// Conversions de format améliorées
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
  return subtitles.map(entry => entry.text).filter(text => text.trim()).join('\n\n');
}

// Formatage temporel précis
function formatSrtTime(seconds) {
  const totalMs = Math.round(seconds * 1000);
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

// Fonction HTTP robuste avec gestion des erreurs
function makeHttpsRequest(url, headers = {}, timeout = 30000) {
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
        'DNT': '1',
        ...headers
      },
      timeout: timeout,
      rejectUnauthorized: true
    };

    const req = https.request(options, (res) => {
      // Gestion des redirections
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        console.log(`Redirection vers: ${res.headers.location}`);
        return resolve(makeHttpsRequest(res.headers.location, headers, timeout));
      }

      if (res.statusCode < 200 || res.statusCode >= 400) {
        return reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
      }

      let data = '';
      res.setEncoding('utf8');
      
      res.on('data', chunk => {
        data += chunk;
        // Protection contre les réponses trop volumineuses
        if (data.length > 10 * 1024 * 1024) { // 10MB max
          req.destroy();
          reject(new Error('Réponse trop volumineuse'));
        }
      });
      
      res.on('end', () => {
        if (data.length === 0) {
          reject(new Error('Réponse vide'));
        } else {
          resolve(data);
        }
      });

      res.on('error', error => {
        reject(new Error(`Response error: ${error.message}`));
      });
    });

    req.on('error', error => {
      reject(new Error(`Request error: ${error.message}`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timeout après ${timeout}ms`));
    });

    req.end();
  });
}