// netlify/functions/subtitles.js - VERSION CORRIGÉE AVEC YOUTUBE-TRANSCRIPT
const https = require('https');
const { URL } = require('url');

// Configuration optimisée
const CONFIG = {
    TIMEOUT: 30000,
    MAX_RETRIES: 2,
    USER_AGENT: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
};

exports.handler = async (event, context) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
    };

    // Gérer les requêtes OPTIONS (CORS)
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    if (event.httpMethod !== 'POST') {
        return { 
            statusCode: 405, 
            headers, 
            body: JSON.stringify({ error: 'Méthode non autorisée - utilisez POST' }) 
        };
    }

    let videoId, format, language;

    try {
        // Parser le body de la requête
        const body = JSON.parse(event.body || '{}');
        videoId = body.videoId;
        format = body.format || 'srt';
        language = body.language || 'en';

        console.log(`🎬 Demande extraction: ${videoId} (${language}, ${format})`);

        // Validation de l'ID vidéo
        if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ 
                    error: 'ID vidéo YouTube invalide (format: 11 caractères alphanumériques)',
                    example: 'dQw4w9WgXcQ'
                })
            };
        }

        // Extraire les sous-titres avec la nouvelle méthode
        const transcripts = await getYouTubeTranscripts(videoId, language);
        
        if (!transcripts || transcripts.length === 0) {
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({ 
                    error: 'Aucun sous-titre trouvé pour cette vidéo',
                    suggestion: 'Vérifiez que la vidéo a des sous-titres activés ou essayez "auto" pour la langue'
                })
            };
        }

        // Convertir au format demandé
        const convertedContent = convertTranscriptsToFormat(transcripts, format);
        
        console.log(`✅ Extraction réussie: ${transcripts.length} segments`);

        return {
            statusCode: 200,
            headers: {
                ...headers,
                'Content-Type': getContentTypeForFormat(format),
                'Content-Disposition': `attachment; filename="${videoId}_${language}_${Date.now()}.${format}"`
            },
            body: convertedContent
        };

    } catch (error) {
        console.error('❌ Erreur extraction:', error);
        
        // Messages d'erreur spécifiques
        let errorMessage = error.message;
        let statusCode = 500;

        if (error.message.includes('Video unavailable') || error.message.includes('not found')) {
            statusCode = 404;
            errorMessage = 'Vidéo non trouvée, privée ou supprimée';
        } else if (error.message.includes('No transcripts')) {
            statusCode = 404;
            errorMessage = 'Aucun sous-titre disponible pour cette vidéo';
        } else if (error.message.includes('timeout') || error.message.includes('TIMEOUT')) {
            statusCode = 408;
            errorMessage = 'Délai d\'attente dépassé - réessayez dans quelques secondes';
        }

        return {
            statusCode,
            headers,
            body: JSON.stringify({ 
                error: errorMessage,
                videoId: videoId || 'unknown',
                details: process.env.NODE_ENV === 'development' ? error.stack : undefined
            })
        };
    }
};

// NOUVELLE FONCTION PRINCIPALE : Obtenir les transcripts YouTube
async function getYouTubeTranscripts(videoId, targetLanguage = 'en') {
    try {
        console.log(`🔍 Recherche transcripts pour: ${videoId}`);
        
        // Étape 1: Récupérer la page YouTube
        const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
        const html = await makeHttpRequest(watchUrl);
        
        // Étape 2: Extraire les informations de transcripts
        const transcriptInfo = extractTranscriptInfo(html);
        
        if (!transcriptInfo || transcriptInfo.length === 0) {
            throw new Error('No transcripts available for this video');
        }

        console.log(`📋 ${transcriptInfo.length} transcript(s) trouvé(s)`);
        
        // Étape 3: Sélectionner le meilleur transcript
        const selectedTranscript = selectBestTranscript(transcriptInfo, targetLanguage);
        
        if (!selectedTranscript) {
            const available = transcriptInfo.map(t => t.languageCode).join(', ');
            throw new Error(`Language "${targetLanguage}" not available. Available: ${available}`);
        }

        console.log(`🎯 Transcript sélectionné: ${selectedTranscript.languageCode}`);

        // Étape 4: Télécharger le transcript
        const transcriptData = await downloadTranscript(selectedTranscript.url);
        
        // Étape 5: Parser le contenu XML
        const parsedTranscripts = parseTranscriptXML(transcriptData);
        
        console.log(`✅ ${parsedTranscripts.length} segments extraits`);
        return parsedTranscripts;

    } catch (error) {
        console.error('❌ Erreur getYouTubeTranscripts:', error);
        throw error;
    }
}

// Extraire les informations de transcript depuis le HTML
function extractTranscriptInfo(html) {
    const transcripts = [];
    
    try {
        // Rechercher ytInitialPlayerResponse
        const playerResponseMatch = html.match(/var ytInitialPlayerResponse\s*=\s*({.+?});/);
        if (!playerResponseMatch) {
            throw new Error('Player response not found');
        }

        const playerResponse = JSON.parse(playerResponseMatch[1]);
        const captions = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        
        if (!captions || captions.length === 0) {
            throw new Error('No caption tracks found');
        }

        // Traiter chaque piste de sous-titres
        captions.forEach(caption => {
            transcripts.push({
                languageCode: caption.languageCode,
                languageName: caption.name?.simpleText || caption.languageCode,
                url: caption.baseUrl,
                isAutoGenerated: caption.kind === 'asr'
            });
        });

        return transcripts;

    } catch (error) {
        console.error('❌ Erreur extraction transcript info:', error);
        
        // Méthode de fallback - recherche par regex
        try {
            const captionRegex = /"captionTracks":\[(.*?)\]/s;
            const match = html.match(captionRegex);
            
            if (match && match[1]) {
                const captionsStr = '[' + match[1] + ']';
                const captions = JSON.parse(captionsStr);
                
                return captions.map(caption => ({
                    languageCode: caption.languageCode || 'en',
                    languageName: caption.name?.simpleText || caption.languageCode || 'Unknown',
                    url: caption.baseUrl,
                    isAutoGenerated: caption.kind === 'asr'
                }));
            }
        } catch (fallbackError) {
            console.error('❌ Fallback extraction failed:', fallbackError);
        }

        return [];
    }
}

// Sélectionner le meilleur transcript selon la langue demandée
function selectBestTranscript(transcripts, targetLanguage) {
    if (!transcripts || transcripts.length === 0) return null;

    console.log(`🔍 Recherche langue: "${targetLanguage}"`);
    console.log('📝 Langues disponibles:', transcripts.map(t => `${t.languageCode} (${t.languageName})`));

    // 1. Correspondance exacte
    let transcript = transcripts.find(t => t.languageCode === targetLanguage);
    if (transcript) return transcript;

    // 2. Correspondance par préfixe (ex: 'en' pour 'en-US')
    const langPrefix = targetLanguage.split('-')[0];
    transcript = transcripts.find(t => t.languageCode.startsWith(langPrefix));
    if (transcript) return transcript;

    // 3. Si "auto" est demandé, prendre le premier auto-généré
    if (targetLanguage === 'auto' || targetLanguage === '') {
        transcript = transcripts.find(t => t.isAutoGenerated);
        if (transcript) return transcript;
    }

    // 4. Fallback vers anglais
    transcript = transcripts.find(t => t.languageCode.startsWith('en'));
    if (transcript) return transcript;

    // 5. Premier disponible
    return transcripts[0];
}

// Télécharger le contenu du transcript
async function downloadTranscript(transcriptUrl) {
    if (!transcriptUrl) {
        throw new Error('Transcript URL is missing');
    }

    try {
        // Ajouter les paramètres nécessaires
        const url = new URL(transcriptUrl);
        url.searchParams.set('fmt', 'srv3'); // Format XML structured
        
        console.log(`📥 Téléchargement transcript: ${url.toString().substring(0, 100)}...`);
        
        const content = await makeHttpRequest(url.toString(), {
            'Accept': 'text/xml, application/xml, text/plain, */*',
            'Referer': 'https://www.youtube.com/'
        });

        if (!content || content.trim().length === 0) {
            throw new Error('Empty transcript content');
        }

        console.log(`✅ Transcript téléchargé: ${content.length} caractères`);
        return content;

    } catch (error) {
        console.error('❌ Erreur téléchargement transcript:', error);
        throw new Error(`Failed to download transcript: ${error.message}`);
    }
}

// Parser le XML du transcript
function parseTranscriptXML(xmlContent) {
    const segments = [];
    
    try {
        // Regex pour extraire les segments <text>
        const textRegex = /<text start="([^"]*)"(?:\s+dur="([^"]*)")?[^>]*>(.*?)<\/text>/gs;
        let match;
        let index = 1;

        while ((match = textRegex.exec(xmlContent)) !== null) {
            const start = parseFloat(match[1]) || 0;
            const duration = parseFloat(match[2]) || 3.0; // Durée par défaut
            let text = match[3] || '';

            // Nettoyer le texte
            text = cleanTranscriptText(text);

            if (text.trim()) {
                segments.push({
                    index: index++,
                    start: start,
                    duration: duration,
                    end: start + duration,
                    text: text
                });
            }
        }

        return segments;

    } catch (error) {
        console.error('❌ Erreur parsing XML:', error);
        throw new Error(`Failed to parse transcript XML: ${error.message}`);
    }
}

// Nettoyer le texte du transcript
function cleanTranscriptText(text) {
    if (!text) return '';

    return text
        // Décoder les entités HTML
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&nbsp;/g, ' ')
        
        // Supprimer les balises XML/HTML
        .replace(/<[^>]*>/g, '')
        
        // Nettoyer les espaces
        .replace(/\s+/g, ' ')
        .replace(/\n+/g, ' ')
        .trim();
}

// Convertir les transcripts au format demandé
function convertTranscriptsToFormat(transcripts, format) {
    if (!transcripts || transcripts.length === 0) {
        return format === 'json' ? '[]' : '';
    }

    switch (format.toLowerCase()) {
        case 'srt':
            return transcripts.map(segment => {
                const start = formatTimeForSRT(segment.start);
                const end = formatTimeForSRT(segment.end);
                return `${segment.index}\n${start} --> ${end}\n${segment.text}\n`;
            }).join('\n');

        case 'vtt':
            const vttContent = transcripts.map(segment => {
                const start = formatTimeForVTT(segment.start);
                const end = formatTimeForVTT(segment.end);
                return `${start} --> ${end}\n${segment.text}\n`;
            }).join('\n');
            return `WEBVTT\n\n${vttContent}`;

        case 'txt':
            return transcripts.map(segment => segment.text).join(' ');

        case 'json':
        default:
            return JSON.stringify(transcripts, null, 2);
    }
}

// Fonctions utilitaires pour le formatage du temps
function formatTimeForSRT(seconds) {
    const totalMs = Math.round(seconds * 1000);
    const hours = Math.floor(totalMs / 3600000);
    const minutes = Math.floor((totalMs % 3600000) / 60000);
    const secs = Math.floor((totalMs % 60000) / 1000);
    const ms = totalMs % 1000;
    
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

function formatTimeForVTT(seconds) {
    return formatTimeForSRT(seconds).replace(',', '.');
}

function getContentTypeForFormat(format) {
    const types = {
        'srt': 'application/x-subrip; charset=utf-8',
        'vtt': 'text/vtt; charset=utf-8', 
        'txt': 'text/plain; charset=utf-8',
        'json': 'application/json; charset=utf-8'
    };
    return types[format.toLowerCase()] || 'text/plain; charset=utf-8';
}

// Fonction HTTP améliorée
function makeHttpRequest(url, customHeaders = {}) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        
        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || 443,
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            headers: {
                'User-Agent': CONFIG.USER_AGENT,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9,fr;q=0.8',
                'Accept-Encoding': 'identity',
                'Connection': 'keep-alive',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Sec-Fetch-User': '?1',
                'Upgrade-Insecure-Requests': '1',
                ...customHeaders
            }
        };

        console.log(`🌐 Requête HTTP: ${urlObj.hostname}${options.path.substring(0, 50)}...`);

        const req = https.request(options, (res) => {
            let data = '';
            
            // Gérer les redirections
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                console.log(`🔄 Redirection: ${res.statusCode} -> ${res.headers.location}`);
                return makeHttpRequest(res.headers.location, customHeaders)
                    .then(resolve)
                    .catch(reject);
            }

            res.setEncoding('utf8');
            res.on('data', chunk => data += chunk);
            
            res.on('end', () => {
                console.log(`📊 Réponse: ${res.statusCode} (${data.length} chars)`);
                
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(data);
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
                }
            });
        });

        req.on('error', (error) => {
            console.error('❌ Erreur HTTP:', error.message);
            reject(error);
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error(`Timeout après ${CONFIG.TIMEOUT}ms`));
        });

        req.setTimeout(CONFIG.TIMEOUT);
        req.end();
    });
}

// Log de démarrage
console.log('🚀 Fonction Netlify subtitles.js chargée (version YouTube-transcript)');