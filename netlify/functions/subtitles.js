const { google } = require('googleapis');

// Configuration YouTube API
const youtube = google.youtube('v3');

exports.handler = async (event, context) => {
  // Headers CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Gérer les requêtes OPTIONS (preflight)
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Méthode non autorisée' })
    };
  }

  try {
    // Vérifier la présence de la clé API
    const API_KEY = process.env.YOUTUBE_API_KEY;
    if (!API_KEY || API_KEY === 'YOUR_YOUTUBE_API_KEY') {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ 
          error: 'Clé API YouTube non configurée sur le serveur' 
        })
      };
    }

    // Parser le body de la requête
    let requestData;
    try {
      requestData = JSON.parse(event.body || '{}');
    } catch (parseError) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Corps de requête invalide' })
      };
    }

    const { videoId, format = 'srt', language = 'fr' } = requestData;

    if (!videoId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'ID vidéo manquant' })
      };
    }

    console.log(`[SUBTITLES] Traitement vidéo: ${videoId}, format: ${format}, langue: ${language}`);

    // Vérifier si la vidéo existe
    try {
      const videoResponse = await youtube.videos.list({
        key: API_KEY,
        part: 'snippet,contentDetails',
        id: videoId
      });

      if (!videoResponse.data.items || videoResponse.data.items.length === 0) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'Vidéo non trouvée' })
        };
      }

      const video = videoResponse.data.items[0];
      console.log(`[SUBTITLES] Vidéo trouvée: ${video.snippet.title}`);

      // Récupérer la liste des sous-titres disponibles
      const captionsResponse = await youtube.captions.list({
        key: API_KEY,
        part: 'snippet',
        videoId: videoId
      });

      const captions = captionsResponse.data.items || [];
      console.log(`[SUBTITLES] ${captions.length} sous-titres trouvés`);
      
      if (captions.length === 0) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ 
            error: 'Aucun sous-titre disponible pour cette vidéo',
            videoTitle: video.snippet.title 
          })
        };
      }

      // Chercher les sous-titres dans la langue demandée
      let selectedCaption = captions.find(cap => cap.snippet.language === language);
      if (!selectedCaption) {
        selectedCaption = captions.find(cap => cap.snippet.language === 'en');
        if (!selectedCaption) {
          selectedCaption = captions[0];
        }
      }

      console.log(`[SUBTITLES] Sous-titre sélectionné: ${selectedCaption.snippet.language} - ${selectedCaption.snippet.name}`);

      // Télécharger le contenu des sous-titres
      const captionDownload = await youtube.captions.download({
        key: API_KEY,
        id: selectedCaption.id,
        tfmt: format === 'vtt' ? 'webvtt' : (format === 'srt' ? 'srt' : 'transcript')
      });

      let content = captionDownload.data;

      // Convertir au format demandé si nécessaire
      if (format === 'txt') {
        content = convertToPlainText(content);
      }

      console.log(`[SUBTITLES] Sous-titres extraits avec succès (${content.length} caractères)`);

      return {
        statusCode: 200,
        headers: {
          ...headers,
          'Content-Type': 'text/plain; charset=utf-8',
        },
        body: content
      };

    } catch (apiError) {
      console.error('[SUBTITLES] Erreur API YouTube:', apiError);
      
      let errorMessage = 'Erreur lors de la communication avec YouTube';
      let statusCode = 500;
      
      if (apiError.code === 403) {
        errorMessage = 'Accès refusé - Vérifiez la clé API YouTube ou les quotas';
        statusCode = 403;
      } else if (apiError.code === 404) {
        errorMessage = 'Vidéo ou sous-titres non trouvés';
        statusCode = 404;
      } else if (apiError.code === 401) {
        errorMessage = 'Clé API YouTube invalide ou expirée';
        statusCode = 401;
      }

      return {
        statusCode,
        headers,
        body: JSON.stringify({ 
          error: errorMessage,
          details: process.env.NODE_ENV === 'development' ? apiError.message : undefined
        })
      };
    }

  } catch (error) {
    console.error('[SUBTITLES] Erreur générale:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Erreur interne du serveur',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      })
    };
  }
};

// Fonction utilitaire pour convertir en texte brut
function convertToPlainText(srtContent) {
  if (!srtContent) return '';
  
  return srtContent
    .split('\n')
    .filter(line => {
      // Supprimer les numéros de séquence et les timestamps
      return line.trim() && 
             !line.match(/^\d+$/) && 
             !line.match(/^\d{2}:\d{2}:\d{2}.*-->/);
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n') // Réduire les sauts de ligne multiples
    .trim();
}