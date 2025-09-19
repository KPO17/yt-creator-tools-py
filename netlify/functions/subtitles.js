// netlify/functions/subtitles.js
import { YoutubeTranscript } from 'youtube-transcript';

export const handler = async (event, context) => {
    // Headers CORS
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json'
    };
    
    // Gérer OPTIONS (preflight CORS)
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: ''
        };
    }
    
    // Vérifier méthode POST
    if (event.httpMethod !== 'POST') {
        return errorResponse(corsHeaders, 405, 'Méthode non autorisée');
    }
    
    try {
        // Parser le body
        if (!event.body) {
            return errorResponse(corsHeaders, 400, 'Corps de requête manquant');
        }
        
        const body = JSON.parse(event.body);
        const videoId = body.videoId?.trim();
        const format = body.format?.toLowerCase() || 'txt';
        const language = body.language || 'fr';
        
        // Validation
        if (!videoId) {
            return errorResponse(corsHeaders, 400, 'ID vidéo manquant');
        }
        
        if (!validateVideoId(videoId)) {
            return errorResponse(corsHeaders, 400, 'ID vidéo invalide');
        }
        
        console.log(`Traitement vidéo ${videoId}, format ${format}, langue ${language}`);
        
        // Extraire les sous-titres avec youtube-transcript
        const subtitles = await extractSubtitlesWithYoutubeTranscript(videoId, language);
        
        if (!subtitles || subtitles.length === 0) {
            return errorResponse(corsHeaders, 404, 'Aucun sous-titre trouvé pour cette vidéo');
        }
        
        // Formater selon le type demandé
        const formattedContent = formatSubtitles(subtitles, format);
        
        // Headers selon le format
        const contentType = getContentType(format);
        const finalHeaders = { ...corsHeaders, 'Content-Type': contentType };
        
        return {
            statusCode: 200,
            headers: finalHeaders,
            body: formattedContent
        };
        
    } catch (error) {
        console.error('Erreur dans la fonction:', error);
        
        // Gestion des erreurs spécifiques de youtube-transcript
        let errorMessage = 'Erreur lors de l\'extraction des sous-titres';
        
        if (error.message?.includes('No transcript found')) {
            errorMessage = 'Aucun sous-titre disponible pour cette vidéo ou cette langue';
        } else if (error.message?.includes('Video unavailable')) {
            errorMessage = 'Vidéo non disponible ou privée';
        } else if (error.message?.includes('Invalid video')) {
            errorMessage = 'ID vidéo invalide';
        }
        
        return errorResponse(corsHeaders, 500, errorMessage);
    }
};

// Fonction principale d'extraction avec youtube-transcript
async function extractSubtitlesWithYoutubeTranscript(videoId, targetLanguage) {
    try {
        console.log(`Extraction avec youtube-transcript: ${videoId}, langue: ${targetLanguage}`);
        
        // Essayer d'abord avec la langue demandée
        let transcript;
        
        try {
            transcript = await YoutubeTranscript.fetchTranscript(videoId, {
                lang: targetLanguage,
                country: getCountryForLanguage(targetLanguage)
            });
            console.log(`Transcript trouvé en ${targetLanguage}: ${transcript.length} segments`);
        } catch (error) {
            console.log(`Langue ${targetLanguage} non disponible, essai avec l'anglais...`);
            
            // Fallback vers l'anglais
            try {
                transcript = await YoutubeTranscript.fetchTranscript(videoId, {
                    lang: 'en'
                });
                console.log(`Transcript trouvé en anglais: ${transcript.length} segments`);
            } catch (enError) {
                console.log('Anglais non disponible, essai sans spécifier la langue...');
                
                // Fallback vers n'importe quelle langue disponible
                transcript = await YoutubeTranscript.fetchTranscript(videoId);
                console.log(`Transcript trouvé (langue auto): ${transcript.length} segments`);
            }
        }
        
        if (!transcript || transcript.length === 0) {
            throw new Error('Aucun transcript disponible');
        }
        
        // Normaliser le format
        return transcript.map(item => ({
            start: item.offset / 1000, // youtube-transcript utilise des millisecondes
            duration: item.duration / 1000,
            text: cleanText(item.text)
        }));
        
    } catch (error) {
        console.error('Erreur youtube-transcript:', error);
        throw error;
    }
}

// Fonctions utilitaires
function validateVideoId(videoId) {
    return /^[a-zA-Z0-9_-]{11}$/.test(videoId);
}

function getCountryForLanguage(lang) {
    const langToCountry = {
        'fr': 'FR',
        'en': 'US',
        'es': 'ES',
        'de': 'DE',
        'it': 'IT',
        'pt': 'PT',
        'ru': 'RU',
        'ja': 'JP',
        'ko': 'KR',
        'ar': 'SA'
    };
    return langToCountry[lang] || 'US';
}

function cleanText(text) {
    if (!text) return '';
    
    // Nettoyer le texte
    return text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function formatSubtitles(subtitles, format) {
    if (!subtitles || subtitles.length === 0) {
        return '';
    }
    
    switch (format) {
        case 'json':
            return JSON.stringify(subtitles, null, 2);
            
        case 'txt':
            return subtitles.map(item => item.text).join('\n');
            
        case 'srt':
            return formatAsSRT(subtitles);
            
        case 'vtt':
            return formatAsVTT(subtitles);
            
        default:
            return subtitles.map(item => item.text).join('\n');
    }
}

function formatAsSRT(subtitles) {
    const srtContent = [];
    
    subtitles.forEach((item, index) => {
        const startTime = secondsToSRTTime(item.start);
        const endTime = secondsToSRTTime(item.start + item.duration);
        
        srtContent.push(
            (index + 1).toString(),
            `${startTime} --> ${endTime}`,
            item.text,
            ''
        );
    });
    
    return srtContent.join('\n');
}

function formatAsVTT(subtitles) {
    const vttContent = ['WEBVTT', ''];
    
    subtitles.forEach(item => {
        const startTime = secondsToVTTTime(item.start);
        const endTime = secondsToVTTTime(item.start + item.duration);
        
        vttContent.push(
            `${startTime} --> ${endTime}`,
            item.text,
            ''
        );
    });
    
    return vttContent.join('\n');
}

function secondsToSRTTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const milliseconds = Math.floor((seconds % 1) * 1000);
    
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${milliseconds.toString().padStart(3, '0')}`;
}

function secondsToVTTTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const milliseconds = Math.floor((seconds % 1) * 1000);
    
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
}

function getContentType(format) {
    const contentTypes = {
        'txt': 'text/plain; charset=utf-8',
        'srt': 'application/x-subrip; charset=utf-8',
        'vtt': 'text/vtt; charset=utf-8',
        'json': 'application/json; charset=utf-8'
    };
    
    return contentTypes[format] || 'text/plain; charset=utf-8';
}

function errorResponse(headers, status, message) {
    return {
        statusCode: status,
        headers,
        body: JSON.stringify({ error: message })
    };
}