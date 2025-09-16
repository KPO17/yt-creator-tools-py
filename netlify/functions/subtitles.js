// Version simplifiée sans dépendances externes
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
      console.log('ERREUR: Clé API YouTube non configurée');
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ 
          error: 'Service temporairement indisponible - Configuration en cours' 
        })
      };
    }

    // Parser le body de la requête
    let requestData;
    try {
      requestData = JSON.parse(event.body || '{}');
    } catch (parseError) {
      console.log('ERREUR: Parse JSON:', parseError);
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

    console.log(`[SUBTITLES] Début traitement: ${videoId}, format: ${format}`);

    // Étape 1: Vérifier si la vidéo existe
    const videoUrl = `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&part=snippet&key=${API_KEY}`;
    
    const videoResponse = await fetch(videoUrl);
    if (!videoResponse.ok) {
      console.log('ERREUR: API vidéo:', videoResponse.status, videoResponse.statusText);
      return {
        statusCode: videoResponse.status,
        headers,
        body: JSON.stringify({ 
          error: videoResponse.status === 403 ? 'Limite API atteinte' : 'Erreur API YouTube' 
        })
      };
    }

    const videoData = await videoResponse.json();
    if (!videoData.items || videoData.items.length === 0) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Vidéo non trouvée' })
      };
    }

    const video = videoData.items[0];
    console.log(`[SUBTITLES] Vidéo trouvée: ${video.snippet.title}`);

    // Étape 2: Récupérer la liste des sous-titres
    const captionsUrl = `https://www.googleapis.com/youtube/v3/captions?videoId=${videoId}&part=snippet&key=${API_KEY}`;
    
    const captionsResponse = await fetch(captionsUrl);
    if (!captionsResponse.ok) {
      console.log('ERREUR: API captions:', captionsResponse.status);
      return {
        statusCode: captionsResponse.status,
        headers,
        body: JSON.stringify({ 
          error: 'Erreur lors de la récupération des sous-titres' 
        })
      };
    }

    const captionsData = await captionsResponse.json();
    const captions = captionsData.items || [];
    
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

    // Étape 3: Sélectionner les sous-titres appropriés
    let selectedCaption = captions.find(cap => cap.snippet.language === language);
    if (!selectedCaption) {
      selectedCaption = captions.find(cap => cap.snippet.language === 'en');
      if (!selectedCaption) {
        selectedCaption = captions[0];
      }
    }

    console.log(`[SUBTITLES] Sous-titre sélectionné: ${selectedCaption.snippet.language} - ${selectedCaption.snippet.name}`);

    // Étape 4: Télécharger le contenu des sous-titres
    const downloadFormat = format === 'vtt' ? 'webvtt' : (format === 'srt' ? 'srt' : 'transcript');
    const downloadUrl = `https://www.googleapis.com/youtube/v3/captions/${selectedCaption.id}?tfmt=${downloadFormat}&key=${API_KEY}`;
    
    const downloadResponse = await fetch(downloadUrl);
    if (!downloadResponse.ok) {
      console.log('ERREUR: Téléchargement sous-titres:', downloadResponse.status);
      
      // L'API YouTube peut refuser le téléchargement pour certaines vidéos
      if (downloadResponse.status === 403) {
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({ 
            error: 'Sous-titres protégés - Téléchargement non autorisé par YouTube' 
          })
        };
      }
      
      return {
        statusCode: downloadResponse.status,
        headers,
        body: JSON.stringify({ 
          error: 'Impossible de télécharger les sous-titres' 
        })
      };
    }

    let content = await downloadResponse.text();

    // Étape 5: Convertir au format demandé
    if (format === 'txt') {
      content = convertToPlainText(content);
    }

    if (!content || content.trim().length === 0) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ 
          error: 'Contenu des sous-titres vide' 
        })
      };
    }

    console.log(`[SUBTITLES] Succès: ${content.length} caractères extraits`);

    // Étape 6: Retourner le contenu
    return {
      statusCode: 200,
      headers: {
        ...headers,
        'Content-Type': 'text/plain; charset=utf-8',
      },
      body: content
    };

  } catch (error) {
    console.error('[SUBTITLES] Erreur générale:', error.message, error.stack);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Erreur interne du serveur',
        details: process.env.NODE_ENV === 'development' ? error.message : 'Veuillez réessayer plus tard'
      })
    };
  }
};

// Fonction utilitaire pour convertir en texte brut
function convertToPlainText(content) {
  if (!content) return '';
  
  try {
    return content
      .split('\n')
      .filter(line => {
        const trimmed = line.trim();
        // Supprimer les numéros de séquence et les timestamps SRT
        return trimmed && 
               !trimmed.match(/^\d+$/) && 
               !trimmed.match(/^\d{2}:\d{2}:\d{2}.*-->/);
      })
      .join('\n')
      .replace(/\n{3,}/g, '\n\n') // Réduire les sauts de ligne multiples
      .replace(/<[^>]+>/g, '') // Supprimer les balises HTML/XML
      .trim();
  } catch (error) {
    console.error('Erreur conversion texte:', error);
    return content; // Retourner le contenu original en cas d'erreur
  }
}