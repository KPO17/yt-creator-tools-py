// netlify/functions/subtitles.js - SOLUTION QUI MARCHE COMME DOWNSUB
const https = require('https');
const { URL } = require('url');

// Configuration simple et efficace
const CONFIG = {
    TIMEOUT: 20000,
    USER_AGENT: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

exports.handler = async (event, context) => {
    // Headers CORS
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
        const { videoId, format = 'srt', language = 'en' } = JSON.parse(event.body || '{}');

        if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'ID vidéo invalide' })
            };
        }

        console.log(`Extraction sous-titres: ${videoId} (${language}, ${format})`);

        // MÉTHODE SIMPLE COMME DOWNSUB - Récupérer la liste des sous-titres
        const captionsList = await getCaptionsList(videoId);
        
        if (!captionsList || captionsList.length === 0) {
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({ error: 'Aucun sous-titre disponible' })
            };
        }

        // Sélectionner la meilleure piste
        const selectedTrack = selectBestTrack(captionsList, language);
        
        if (!selectedTrack) {
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({ 
                    error: `Aucun sous-titre pour la langue: ${language}`,
                    availableLanguages: captionsList.map(c => c.language_code)
                })
            };
        }

        // Télécharger les sous-titres
        const subtitleContent = await downloadSubtitles(selectedTrack.base_url);
        
        // Parser et convertir
        const parsedSubtitles = parseSubtitles(subtitleContent);
        const convertedContent = convertToFormat(parsedSubtitles, format);

        return {
            statusCode: 200,
            headers: {
                ...headers,
                'Content-Type': getContentType(format),
                'Content-Disposition': `attachment; filename="${videoId}_${language}.${format}"`
            },
            body: convertedContent
        };

    } catch (error) {
        console.error('Erreur extraction:', error.message);
        
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                error: error.message || 'Erreur lors de l\'extraction',
                details: error.stack
            })
        };
    }
};

// Récupérer la liste des sous-titres (comme DownSub)
async function getCaptionsList(videoId) {
    const url = `https://www.youtube.com/api/timedtext?type=list&v=${videoId}`;
    
    try {
        const response = await makeHttpRequest(url);
        
        // Parser XML simple
        const tracks = [];
        const trackRegex = /<track[^>]*>/g;
        let match;
        
        while ((match = trackRegex.exec(response)) !== null) {
            const track = match[0];
            
            const langMatch = track.match(/lang_code="([^"]*)"/);
            const nameMatch = track.match(/name="([^"]*)"/);
            const langOrigMatch = track.match(/lang_original="([^"]*)"/);
            
            if (langMatch) {
                tracks.push({
                    language_code: langMatch[1],
                    language_name: nameMatch ? nameMatch[1] : langMatch[1],
                    language_original: langOrigMatch ? langOrigMatch[1] : null,
                    base_url: `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${langMatch[1]}&fmt=srv3`
                });
            }
        }
        
        console.log(`Pistes trouvées: ${tracks.length}`);
        return tracks;
        
    } catch (error) {
        console.error('Erreur récupération liste:', error.message);
        return [];
    }
}

// Sélectionner la meilleure piste (logique DownSub)
function selectBestTrack(tracks, requestedLang) {
    if (!tracks || tracks.length === 0) return null;
    
    // 1. Recherche exacte
    let track = tracks.find(t => t.language_code === requestedLang);
    if (track) return track;
    
    // 2. Recherche par préfixe (ex: 'en' pour 'en-US')
    track = tracks.find(t => t.language_code.startsWith(requestedLang.substring(0, 2)));
    if (track) return track;
    
    // 3. Recherche dans le nom
    const langNames = {
        'fr': ['french', 'français', 'francais'],
        'en': ['english', 'anglais'],
        'es': ['spanish', 'español', 'espanol'],
        'de': ['german', 'deutsch'],
        'it': ['italian', 'italiano']
    };
    
    const searchNames = langNames[requestedLang.toLowerCase()] || [];
    track = tracks.find(t => 
        searchNames.some(name => 
            t.language_name.toLowerCase().includes(name)
        )
    );
    if (track) return track;
    
    // 4. Fallback : première piste ou anglais
    track = tracks.find(t => t.language_code.startsWith('en'));
    return track || tracks[0];
}

// Télécharger les sous-titres
async function downloadSubtitles(url) {
    console.log('Téléchargement depuis:', url);
    return makeHttpRequest(url);
}

// Parser les sous-titres YouTube
function parseSubtitles(content) {
    const subtitles = [];
    
    try {
        // Format JSON3 (le plus courant)
        if (content.trim().startsWith('{')) {
            const data = JSON.parse(content);
            
            if (data.events) {
                data.events.forEach(event => {
                    if (event.segs && event.segs.length > 0) {
                        const text = event.segs.map(seg => seg.utf8 || '').join('').trim();
                        if (text) {
                            subtitles.push({
                                start: (event.tStartMs || 0) / 1000,
                                duration: (event.dDurationMs || 2000) / 1000,
                                text: cleanText(text)
                            });
                        }
                    }
                });
            }
            
            return subtitles;
        }
    } catch (e) {
        console.log('Pas du JSON, essai XML...');
    }
    
    // Format XML/SRV3
    const textRegex = /<text start="([^"]*)"[^>]*dur="([^"]*)"[^>]*>([^<]*)<\/text>/g;
    let match;
    
    while ((match = textRegex.exec(content)) !== null) {
        const start = parseFloat(match[1]);
        const duration = parseFloat(match[2]) || 2.0;
        const text = cleanText(match[3]);
        
        if (text) {
            subtitles.push({
                start,
                duration,
                text
            });
        }
    }
    
    return subtitles;
}

// Nettoyer le texte
function cleanText(text) {
    return text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/\n/g, ' ')
        .trim();
}

// Convertir au format demandé
function convertToFormat(subtitles, format) {
    if (!subtitles || subtitles.length === 0) {
        return format === 'json' ? '[]' : '';
    }

    switch (format.toLowerCase()) {
        case 'srt':
            return subtitles.map((sub, index) => {
                const start = formatTime(sub.start);
                const end = formatTime(sub.start + sub.duration);
                return `${index + 1}\n${start} --> ${end}\n${sub.text}\n`;
            }).join('\n');
            
        case 'vtt':
            const vttContent = subtitles.map((sub, index) => {
                const start = formatTimeVTT(sub.start);
                const end = formatTimeVTT(sub.start + sub.duration);
                return `${start} --> ${end}\n${sub.text}\n`;
            }).join('\n');
            return `WEBVTT\n\n${vttContent}`;
            
        case 'txt':
            return subtitles.map(sub => sub.text).join(' ');
            
        case 'json':
        default:
            return JSON.stringify(subtitles, null, 2);
    }
}

// Formatter le temps pour SRT
function formatTime(seconds) {
    const totalMs = Math.round(seconds * 1000);
    const hours = Math.floor(totalMs / 3600000);
    const minutes = Math.floor((totalMs % 3600000) / 60000);
    const secs = Math.floor((totalMs % 60000) / 1000);
    const ms = totalMs % 1000;
    
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
}

// Formatter le temps pour VTT
function formatTimeVTT(seconds) {
    return formatTime(seconds).replace(',', '.');
}

// Type de contenu
function getContentType(format) {
    const types = {
        'srt': 'application/x-subrip; charset=utf-8',
        'vtt': 'text/vtt; charset=utf-8',
        'txt': 'text/plain; charset=utf-8',
        'json': 'application/json; charset=utf-8'
    };
    return types[format] || 'text/plain; charset=utf-8';
}

// Fonction HTTP simple
function makeHttpRequest(url) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        
        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || 443,
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            headers: {
                'User-Agent': CONFIG.USER_AGENT,
                'Accept': '*/*',
                'Accept-Language': 'en-US,en;q=0.9,fr;q=0.8'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(data);
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
                }
            });
        });

        req.on('error', reject);
        req.setTimeout(CONFIG.TIMEOUT, () => {
            req.destroy();
            reject(new Error('Timeout'));
        });
        
        req.end();
    });
}