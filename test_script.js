// test-subtitles.js - Script de test pour diagnostiquer les problèmes
const ytdl = require('ytdl-core');

// Fonction de test principale
async function testSubtitleExtraction() {
  console.log('=== TEST D\'EXTRACTION DE SOUS-TITRES ===');
  console.log(`Node.js: ${process.version}`);
  console.log(`ytdl-core: ${require('ytdl-core/package.json').version}\n`);
  
  // Vidéos de test avec différents cas
  const testVideos = [
    {
      id: 'dQw4w9WgXcQ',
      title: 'Rick Astley - Never Gonna Give You Up',
      description: 'Vidéo populaire avec sous-titres'
    },
    {
      id: 'jNQXAC9IVRw', 
      title: 'Me at the zoo',
      description: 'Première vidéo YouTube'
    },
    {
      id: 'M7lc1UVf-VE',
      title: 'YouTube Rewind 2018',
      description: 'Vidéo YouTube officielle'
    }
  ];
  
  for (const video of testVideos) {
    console.log(`\n--- Test: ${video.title} ---`);
    console.log(`ID: ${video.id}`);
    console.log(`Description: ${video.description}`);
    
    try {
      await testSingleVideo(video.id);
      console.log('✅ SUCCÈS');
    } catch (error) {
      console.error('❌ ÉCHEC:', error.message);
    }
    
    console.log('---\n');
  }
}

// Test d'une vidéo individuelle
async function testSingleVideo(videoId) {
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  
  // Test 1: Validation URL
  console.log('1. Validation URL...');
  const isValid = await ytdl.validateURL(videoUrl);
  if (!isValid) {
    throw new Error('URL invalide');
  }
  console.log('   ✓ URL valide');
  
  // Test 2: Récupération des infos
  console.log('2. Récupération des informations...');
  
  const options = {
    requestOptions: {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
      },
      timeout: 30000
    }
  };
  
  const info = await ytdl.getInfo(videoUrl, options);
  console.log(`   ✓ Titre: ${info.videoDetails.title}`);
  console.log(`   ✓ Durée: ${info.videoDetails.lengthSeconds}s`);
  console.log(`   ✓ Vues: ${info.videoDetails.viewCount}`);
  
  // Test 3: Vérification des sous-titres
  console.log('3. Vérification des sous-titres...');
  
  const { player_response } = info;
  const captions = player_response?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  
  if (!captions || captions.length === 0) {
    throw new Error('Aucun sous-titre trouvé');
  }
  
  console.log(`   ✓ ${captions.length} piste(s) de sous-titres trouvée(s)`);
  
  // Afficher les langues disponibles
  captions.forEach((caption, index) => {
    console.log(`   - [${index}] ${caption.languageCode}: ${caption.name?.simpleText || 'Sans nom'}`);
  });
  
  // Test 4: Téléchargement d'une piste
  console.log('4. Test téléchargement sous-titres...');
  
  const firstTrack = captions[0];
  console.log(`   Téléchargement: ${firstTrack.languageCode}`);
  
  try {
    const response = await fetch(firstTrack.baseUrl, {
      headers: {
        'User-Agent': options.requestOptions.headers['User-Agent']
      },
      timeout: 15000
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const subtitleContent = await response.text();
    console.log(`   ✓ Contenu téléchargé: ${subtitleContent.length} caractères`);
    
    // Parser rapidement pour vérifier
    const textRegex = /<text[^>]*>([^<]*)<\/text>/g;
    const matches = subtitleContent.match(textRegex) || [];
    console.log(`   ✓ ${matches.length} segments de texte trouvés`);
    
    if (matches.length > 0) {
      const firstText = matches[0].replace(/<[^>]*>/g, '').trim();
      console.log(`   ✓ Premier segment: "${firstText.substring(0, 50)}..."`);
    }
    
  } catch (downloadError) {
    console.error(`   ❌ Erreur téléchargement: ${downloadError.message}`);
    
    // Informations supplémentaires pour le débogage
    console.log(`   URL: ${firstTrack.baseUrl}`);
    console.log(`   Essai avec curl:
    curl -H "User-Agent: Mozilla/5.0..." "${firstTrack.baseUrl}"`);
    
    throw downloadError;
  }
}

// Test des approches alternatives
async function testAlternativeApproaches() {
  console.log('\n=== TEST APPROCHES ALTERNATIVES ===\n');
  
  const videoId = 'dQw4w9WgXcQ';
  
  // Approche 1: API directe
  console.log('--- Approche API Directe ---');
  try {
    await testDirectAPIApproach(videoId);
    console.log('✅ API directe: SUCCÈS');
  } catch (error) {
    console.error('❌ API directe: ÉCHEC -', error.message);
  }
  
  // Approche 2: Scraping page
  console.log('\n--- Approche Scraping ---');
  try {
    await testScrapingApproach(videoId);
    console.log('✅ Scraping: SUCCÈS');
  } catch (error) {
    console.error('❌ Scraping: ÉCHEC -', error.message);
  }
}

// Test de l'approche API directe
async function testDirectAPIApproach(videoId) {
  const baseUrl = 'https://www.youtube.com/api/timedtext';
  const params = new URLSearchParams({
    v: videoId,
    fmt: 'json3',
    lang: 'en',
    name: ''
  });
  
  const response = await fetch(`${baseUrl}?${params}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Referer': `https://www.youtube.com/watch?v=${videoId}`
    },
    timeout: 15000
  });
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  
  const data = await response.json();
  console.log(`   ✓ Événements trouvés: ${data.events?.length || 0}`);
  
  if (data.events && data.events.length > 0) {
    const firstEvent = data.events[0];
    console.log(`   ✓ Premier événement: ${firstEvent.segs?.[0]?.utf8 || 'N/A'}`);
  }
}

// Test de l'approche scraping
async function testScrapingApproach(videoId) {
  const pageUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const response = await fetch(pageUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    },
    timeout: 20000
  });
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  
  const html = await response.text();
  console.log(`   ✓ Page téléchargée: ${html.length} caractères`);
  
  // Chercher les données de sous-titres
  const captionRegex = /"captions":({.+?}),"/g;
  const match = captionRegex.exec(html);
  
  if (!match) {
    throw new Error('Aucune donnée de sous-titre dans la page');
  }
  
  const captionData = JSON.parse(match[1]);
  const tracks = captionData.playerCaptionsTracklistRenderer?.captionTracks;
  
  if (!tracks) {
    throw new Error('Aucune piste trouvée');
  }
  
  console.log(`   ✓ Pistes trouvées: ${tracks.length}`);
}

// Test de diagnostic réseau
async function networkDiagnostics() {
  console.log('\n=== DIAGNOSTIC RÉSEAU ===\n');
  
  const testUrls = [
    'https://www.youtube.com',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ&fmt=json3&lang=en'
  ];
  
  for (const url of testUrls) {
    console.log(`Test: ${url}`);
    try {
      const start = Date.now();
      const response = await fetch(url, {
        method: 'HEAD',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 10000
      });
      
      const duration = Date.now() - start;
      console.log(`   ✓ ${response.status} ${response.statusText} (${duration}ms)`);
      
    } catch (error) {
      console.error(`   ❌ ${error.message}`);
    }
  }
}

// Fonction principale
async function runAllTests() {
  try {
    await testSubtitleExtraction();
    await testAlternativeApproaches();
    await networkDiagnostics();
    
    console.log('\n=== RÉSUMÉ ===');
    console.log('Tests terminés. Vérifiez les résultats ci-dessus.');
    console.log('\nSi tous les tests échouent:');
    console.log('1. Vérifiez votre connexion internet');
    console.log('2. Essayez avec un VPN');
    console.log('3. Mettez à jour ytdl-core: npm update ytdl-core');
    console.log('4. Vérifiez les restrictions régionales');
    
  } catch (error) {
    console.error('\n❌ ERREUR GÉNÉRALE:', error.message);
    process.exit(1);
  }
}

// Gestion des erreurs non capturées
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Promise rejetée:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Exception non capturée:', error.message);
  process.exit(1);
});

// Lancer les tests si le script est exécuté directement
if (require.main === module) {
  runAllTests();
}

module.exports = {
  testSubtitleExtraction,
  testAlternativeApproaches,
  networkDiagnostics,
  runAllTests
};