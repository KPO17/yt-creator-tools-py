// netlify/functions/subtitles.js - SOLUTION OPTIMALE 2025
const https = require('https');
const http = require('http');

// Configuration optimisée
const CONFIG = {
    DEBUG: process.env.NODE_ENV !== 'production',
    TIMEOUT: 30000,
    MAX_RETRIES: 2,
    USER_AGENTS: [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ]
};

// Logger
function log(level, message, data = null) {
    if (CONFIG.DEBUG) {
        console.log(`[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}`);
        if (data) console.log('Data:', JSON.stringify(data, null, 2).substring(0, 300));
    }
}

// Fonction principale
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

    // Gestion CORS
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    if (event.httpMethod !== 'POST') {
        return createErrorResponse(405, 'Méthode non autorisée', null, headers);
    }

    const requestId = Math.random().toString(36).substring(7);
    log('info', `Nouvelle requête [${requestId}]`);

    // Parse request
    let requestData = {};
    try {
        if (!event.body) throw new Error('Body vide');
        requestData = JSON.parse(event.body);
    } catch (parseError) {
        return createErrorResponse(400, 'JSON invalide', requestId, headers);
    }

    const { videoId, format = 'srt', language = 'fr' } = requestData;

    // Validation
    if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
        return createErrorResponse(400, 'ID vidéo YouTube invalide', requestId, headers);
    }

    const allowedFormats = ['srt', 'vtt', 'txt', 'json'];
    if (!allowedFormats.includes(format.toLowerCase())) {
        return createErrorResponse(400, `Format non supporté: ${format}`, requestId, headers);
    }

    try {
        log('info', `Extraction [${requestId}]`, { videoId, format, language });

        // 1. Essayer l'approche Innertube (plus fiable en 2025)
        let subtitles;
        
        try {
            subtitles = await extractWithInnertubeAPI(videoId, language, requestId);
            log('info', `Succès Innertube [${requestId}]`);
        } catch (innertubeError) {
            log('warn', `Innertube échoué [${requestId}]: ${innertubeError.message}`);
            
            // 2. Fallback: API timedtext directe
            try {
                subtitles = await extractWithTimedTextAPI(videoId, language, requestId);
                log('info', `Succès TimedText [${requestId}]`);
            } catch (timedTextError) {
                log('warn', `TimedText échoué [${requestId}]: ${timedTextError.message}`);
                
                // 3. Fallback final: Service externe
                subtitles = await extractWithExternalService(videoId, language, requestId);
                log('info', `Succès service externe [${requestId}]`);
            }
        }

        if (!subtitles || subtitles.length === 0) {
            return createErrorResponse(404, 'Aucun sous-titre disponible pour cette vidéo', requestId, headers);
        }

        // Convertir au format demandé
        const convertedContent = convertSubtitles(subtitles, format);
        const duration = Date.now() - startTime;
        
        log('info', `Succès global [${requestId}]`, { 
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
        log('error', `Erreur finale [${requestId}]`, { 
            message: error.message, 
            duration: `${duration}ms` 
        });

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
        }

        return createErrorResponse(statusCode, message, requestId, headers);
    }
};

// NOUVELLE APPROCHE 1: API Innertube (recommandée 2025)
async function extractWithInnertubeAPI(videoId, language, requestId) {
    const userAgent = getRandomUserAgent();
    
    // Utiliser l'endpoint Innertube pour récupérer les métadonnées vidéo
    const innertubeData = {
        context: {
            client: {
                clientName: "WEB",
                clientVersion: "2.20231219.01.00",
                hl: language || "en",
                gl: "US",
                userAgent: userAgent
            }
        },
        videoId: videoId
    };

    const response = await makeRequest({
        hostname: 'www.youtube.com',
        path: '/youtubei/v1/player?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'User-Agent': userAgent,
            'Accept': '*/*',
            'Accept-Language': `${language || 'en'},en;q=0.9`,
            'Origin': 'https://www.youtube.com',
            'Referer': `https://www.youtube.com/watch?v=${videoId}`
        }
    }, JSON.stringify(innertubeData));

    const data = JSON.parse(response);
    
    // Extraire les informations de captions
    const captions = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    
    if (!captions || captions.length === 0) {
        throw new Error('Aucun sous-titre trouvé via Innertube');
    }

    // Sélectionner la meilleure piste
    const selectedTrack = findBestCaptionTrack(captions, language);
    
    if (!selectedTrack) {
        throw new Error(`Aucun sous-titre trouvé pour la langue: ${language}`);
    }

    // Télécharger et parser la piste
    const subtitleContent = await downloadCaptionTrack(selectedTrack.baseUrl, userAgent);
    return parseSubtitleContent(subtitleContent);
}

// APPROCHE 2: API TimedText directe (fallback)
async function extractWithTimedTextAPI(videoId, language, requestId) {
    const userAgent = getRandomUserAgent();
    
    // Essayer plusieurs formats et langues
    const languageCodes = language ? [language, language.split('-')[0], 'en'] : ['en', 'fr'];
    
    for (const lang of languageCodes) {
        try {
            const url = `https://www.youtube.com/api/timedtext?v=${videoId}&fmt=json3&lang=${lang}&name=`;
            
            const response = await makeRequest({
                hostname: 'www.youtube.com',
                path: `/api/timedtext?v=${videoId}&fmt=json3&lang=${lang}&name=`,
                method: 'GET',
                headers: {
                    'User-Agent': userAgent,
                    'Accept': 'application/json, text/plain, */*',
                    'Accept-Language': `${lang},en;q=0.9`,
                    'Referer': `https://www.youtube.com/watch?v=${videoId}`,
                    'Origin': 'https://www.youtube.com'
                }
            });
            
            const data = JSON.parse(response);
            
            if (data.events && data.events.length > 0) {
                return data.events
                    .filter(event => event.segs && event.segs.length > 0)
                    .map(event => ({
                        start: event.tStartMs / 1000,
                        dur: event.dDurationMs / 1000,
                        text: event.segs.map(seg => seg.utf8 || '').join('').trim()
                    }))
                    .filter(sub => sub.text);
            }
        } catch (error) {
            log('warn', `TimedText échoué pour langue ${lang}: ${error.message}`);
            continue;
        }
    }
    
    throw new Error('Aucun sous-titre trouvé via TimedText API');
}

// APPROCHE 3: Service externe (fallback ultime)
async function extractWithExternalService(videoId, language, requestId) {
    const userAgent = getRandomUserAgent();
    
    // Utiliser un service public de transcription
    try {
        const response = await makeRequest({
            hostname: 'api.youtubetranscript.dev',
            path: `/api/v1/transcript/${videoId}`,
            method: 'GET',
            headers: {
                'User-Agent': userAgent,
                'Accept': 'application/json'
            }
        });
        
        const data = JSON.parse(response);
        
        if (data.transcript && Array.isArray(data.transcript)) {
            return data.transcript.map(item => ({
                start: item.start || 0,
                dur: item.duration || 2,
                text: item.text || ''
            }));
        }
    } catch (error) {
        log('warn', `Service externe échoué: ${error.message}`);
    }
    
    throw new Error('Toutes les méthodes d\'extraction ont échoué');
}

// Utilitaires
function getRandomUserAgent() {
    return CONFIG.USER_AGENTS[Math.floor(Math.random() * CONFIG.USER_AGENTS.length)];
}

function findBestCaptionTrack(tracks, language) {
    if (!language || language === 'auto') {
        return tracks[0];
    }
    
    // Recherche exacte
    let track = tracks.find(t => t.languageCode === language);
    if (track) return track;
    
    // Recherche par préfixe
    track = tracks.find(t => t.languageCode.startsWith(language.substring(0, 2)));
    if (track) return track;
    
    // Fallback sur la première piste
    return tracks[0];
}

async function downloadCaptionTrack(url, userAgent) {
    return makeRequest({
        hostname: new URL(url).hostname,
        path: new URL(url).pathname + new URL(url).search,
        method: 'GET',
        headers: {
            'User-Agent': userAgent,
            'Accept': 'application/ttml+xml, text/vtt, */*'
        }
    });
}

function parseSubtitleContent(content) {
    const subtitles = [];
    
    try {
        // Essayer JSON d'abord
        const jsonData = JSON.parse(content);
        if (jsonData.events) {
            return jsonData.events
                .filter(event => event.segs && event.segs.length > 0)
                .map(event => ({
                    start: event.tStartMs / 1000,
                    dur: event.dDurationMs / 1000,
                    text: event.segs.map(seg => seg.utf8 || '').join('').trim()
                }))
                .filter(sub => sub.text);
        }
    } catch (e) {
        // Pas du JSON, essayer XML
    }
    
    // Parser XML/TTML
    const textRegex = /<text start="([^"]*)" dur="([^"]*)"[^>]*>([^<]*)<\/text>/g;
    
    let match;
    while ((match = textRegex.exec(content)) !== null) {
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

// Fonction de requête HTTP promisifiée
function makeRequest(options, postData = null) {
    return new Promise((resolve, reject) => {
        const protocol = options.port === 443 || options.hostname.includes('https') ? https : http;
        
        const req = protocol.request(options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(data);
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                }
            });
        });
        
        req.on('error', (err) => {
            reject(err);
        });
        
        req.setTimeout(CONFIG.TIMEOUT, () => {
            req.destroy();
            reject(new Error('Timeout'));
        });
        
        if (postData) {
            req.write(postData);
        }
        
        req.end();
    });
}

// Fonctions de conversion (identiques à votre code original)
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