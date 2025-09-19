const { google } = require('googleapis');

// Configuration YouTube API
const youtube = google.youtube('v3');

exports.handler = async (event, context) => {
  // Headers CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
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
    const { videoId, format = 'srt', language = 'fr' } = JSON.parse(event.body);

    if (!videoId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'ID vidéo manquant' })
      };
    }

    // Vérifier si la vidéo existe et récupérer les informations
    const videoResponse = await youtube.videos.list({
      key: process.env.YOUTUBE_API_KEY,
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

    // Récupérer la liste des sous-titres disponibles
    const captionsResponse = await youtube.captions.list({
      key: process.env.YOUTUBE_API_KEY,
      part: 'snippet',
      videoId: videoId
    });

    const captions = captionsResponse.data.items || [];
    
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

    // Chercher les sous-titres dans la langue demandée, sinon prendre les premiers disponibles
    let selectedCaption = captions.find(cap => cap.snippet.language === language);
    if (!selectedCaption) {
      selectedCaption = captions.find(cap => cap.snippet.language === 'en');
      if (!selectedCaption) {
        selectedCaption = captions[0];
      }
    }

    // Télécharger le contenu des sous-titres
    const captionDownload = await youtube.captions.download({
      key: process.env.YOUTUBE_API_KEY,
      id: selectedCaption.id,
      tfmt: format === 'vtt' ? 'webvtt' : (format === 'srt' ? 'srt' : 'transcript')
    });

    let content = captionDownload.data;

    // Convertir au format demandé si nécessaire
    if (format === 'txt') {
      content = convertToPlainText(content);
    }

    return {
      statusCode: 200,
      headers: {
        ...headers,
        'Content-Type': format === 'json' ? 'application/json' : 'text/plain',
        'Content-Disposition': `attachment; filename="${videoId}_subtitles.${format}"`
      },
      body: format === 'json' ? JSON.stringify({
        videoId,
        videoTitle: video.snippet.title,
        language: selectedCaption.snippet.language,
        format,
        content: content,
        availableLanguages: captions.map(cap => ({
          language: cap.snippet.language,
          name: cap.snippet.name
        }))
      }) : content
    };

  } catch (error) {
    console.error('Erreur extraction sous-titres:', error);
    
    let errorMessage = 'Erreur interne du serveur';
    if (error.code === 403) {
      errorMessage = 'Accès refusé - Vérifiez la clé API YouTube';
    } else if (error.code === 404) {
      errorMessage = 'Sous-titres non trouvés pour cette vidéo';
    }

    return {
      statusCode: error.code || 500,
      headers,
      body: JSON.stringify({ 
        error: errorMessage,
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