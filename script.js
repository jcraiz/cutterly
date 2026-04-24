// =========================== LRS CONFIGURATION ===========================
// EDIT THESE THREE VALUES BEFORE DEPLOYING (provided by your LRS.io account)
const LRS_CONFIG = {
    endpoint: "https://armada-lrs.lrs.io/xapi/",   // <-- replace with your LRS endpoint
    username: "123456",                   // <-- basic auth user
    password: "123456"                    // <-- basic auth pass
};
// =========================================================================

// Global variables
let learner = { name: "", email: "" };
let tincan = null;          // TinCan agent & LRS connection
let currentQuestionIndex = 0;
let quizData = null;
let recognition = null;
let isListening = false;
let currentTargetAnswer = "";
let hintRevealedForCurrentQuestion = false;
let firstAttemptMade = false;

// Quiz questions
const QUIZ_DATA = [
    { id: 1, text: "What do you use to cut meat?", icon: "🥩", options: ["I use a knife.", "I use a fork.", "I use a towel."], correctAnswer: "I use a knife.", vocabKey: "knife" },
    { id: 2, text: "What do you use to eat soup?", icon: "🥣", options: ["I use a spoon.", "I use a fork.", "I use chopsticks."], correctAnswer: "I use a spoon.", vocabKey: "spoon" },
    { id: 3, text: "What do you use to spread butter on bread?", icon: "🍞🧈", options: ["I use a butter knife.", "I use a spatula.", "I use a ladle."], correctAnswer: "I use a butter knife.", vocabKey: "butter knife" },
    { id: 4, text: "What do you use to flip pancakes?", icon: "🥞", options: ["I use a spatula.", "I use a whisk.", "I use tongs."], correctAnswer: "I use a spatula.", vocabKey: "spatula" },
    { id: 5, text: "What do you use to measure small amounts of ingredients?", icon: "🥄⚖️", options: ["I use measuring spoons.", "I use a measuring cup.", "I use a kitchen scale."], correctAnswer: "I use measuring spoons.", vocabKey: "measuring spoons" }
];

// Helper: Levenshtein distance
function levenshteinDistance(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));
    for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= b.length; j++) matrix[j][0] = j;
    for (let j = 1; j <= b.length; j++) {
        for (let i = 1; i <= a.length; i++) {
            const substitutionCost = a[i-1] === b[j-1] ? 0 : 1;
            matrix[j][i] = Math.min(
                matrix[j][i-1] + 1,
                matrix[j-1][i] + 1,
                matrix[j-1][i-1] + substitutionCost
            );
        }
    }
    return matrix[b.length][a.length];
}

function normalizeForComparison(str) {
    return str.toLowerCase().replace(/[.,!?;:()"'\-]/g, ' ').replace(/\s+/g, ' ').trim();
}

function computeSimilarityPercent(spokenRaw, targetRaw) {
    const spokenNorm = normalizeForComparison(spokenRaw);
    const targetNorm = normalizeForComparison(targetRaw);
    if (targetNorm.length === 0) return 0;
    const distance = levenshteinDistance(spokenNorm, targetNorm);
    const maxLen = Math.max(spokenNorm.length, targetNorm.length);
    if (maxLen === 0) return 100;
    return Math.round((1 - distance / maxLen) * 100);
}

// Ring drawing
const canvas = document.getElementById('ringCanvas');
const ctx = canvas.getContext('2d');
function drawRing(percent) {
    const centerX = 70, centerY = 70, radius = 62, lineWidth = 12;
    const startAngle = -0.5 * Math.PI;
    const endAngle = startAngle + (percent / 100) * 2 * Math.PI;
    ctx.clearRect(0, 0, 140, 140);
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
    ctx.strokeStyle = "#e9dfd3";
    ctx.lineWidth = lineWidth;
    ctx.stroke();
    const gradient = ctx.createLinearGradient(20, 20, 120, 120);
    if (percent >= 85) gradient.addColorStop(0, '#2c8c3e'), gradient.addColorStop(1, '#4cae51');
    else if (percent >= 50) gradient.addColorStop(0, '#e6b422'), gradient.addColorStop(1, '#f5b042');
    else gradient.addColorStop(0, '#cf7f5e'), gradient.addColorStop(1, '#e09e7a');
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, startAngle, endAngle);
    ctx.strokeStyle = gradient;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.stroke();
    document.getElementById('ringPercentText').innerText = `${Math.floor(percent)}%`;
}
function updateRingPercent(percent) { drawRing(percent); }

// ---------- xAPI statement helpers (con manejo de errores) ----------
function initXAPI() {
    // Verificar si TinCan está disponible
    if (typeof TinCan === 'undefined') {
        console.warn("TinCan.js no está cargado. Las declaraciones xAPI no se enviarán.");
        return null;
    }
    if (!LRS_CONFIG.endpoint || LRS_CONFIG.endpoint === "https://your-lrs.lrs.io/xapi/") {
        console.warn("LRS no configurado. Las declaraciones xAPI no se enviarán.");
        return null;
    }
    try {
        const lrs = new TinCan.LRS({
            endpoint: LRS_CONFIG.endpoint,
            username: LRS_CONFIG.username,
            password: LRS_CONFIG.password,
            allowFail: true
        });
        console.log("LRS inicializado correctamente");
        return lrs;
    } catch (error) {
        console.error("Error al inicializar LRS:", error);
        return null;
    }
}

function getAgent() {
    return new TinCan.Agent({
        name: learner.name,
        mbox: `mailto:${learner.email}`
    });
}

function sendStatement(verbId, objectId, resultObj = null, extensions = {}) {
    if (!tincan) {
        console.warn("No hay conexión LRS, no se envía statement");
        return Promise.resolve();
    }
    try {
        const actor = getAgent();
        const verb = new TinCan.Verb({ id: verbId });
        const object = new TinCan.Activity({ id: objectId, definition: { name: { "en-US": "Pronunciation Quiz" } } });
        const statement = new TinCan.Statement({ actor, verb, object });
        if (resultObj) {
            statement.result = new TinCan.Result(resultObj);
            if (Object.keys(extensions).length) statement.result.extensions = extensions;
        }
        return tincan.saveStatement(statement).catch(err => console.warn("xAPI error:", err));
    } catch (e) {
        console.error("Error construyendo statement:", e);
        return Promise.resolve();
    }
}

function sendPronunciationStatement(questionId, vocabKey, spokenText, targetText, scorePercent) {
    const activityId = window.location.href + "#question/" + questionId;
    const result = {
        score: { scaled: scorePercent / 100, raw: scorePercent, min: 0, max: 100 },
        success: scorePercent >= 80,
        completion: true
    };
    const extensions = {
        "https://cutleryquiz.com/extensions/spoken_text": spokenText,
        "https://cutleryquiz.com/extensions/target_sentence": targetText,
        "https://cutleryquiz.com/extensions/vocabulary_item": vocabKey,
        "https://cutleryquiz.com/extensions/question_text": QUIZ_DATA[questionId-1].text
    };
    sendStatement("http://adlnet.gov/expapi/verbs/answered", activityId, result, extensions);
}

// Mostrar la pista (solo después del primer error)
function showHint() {
    const hintEl = document.getElementById('targetPhrasePreview');
    if (hintEl && hintEl.style.display === 'none') {
        hintEl.style.display = 'block';
        hintRevealedForCurrentQuestion = true;
    }
}

function resetHintForNewQuestion() {
    const hintEl = document.getElementById('targetPhrasePreview');
    if (hintEl) hintEl.style.display = 'none';
    hintRevealedForCurrentQuestion = false;
    firstAttemptMade = false;
}

// Cargar pregunta
function loadQuestion(index) {
    const q = QUIZ_DATA[index];
    document.getElementById('questionText').innerText = q.text;
    document.getElementById('questionIcon').innerText = q.icon;
    currentTargetAnswer = q.correctAnswer;
    const hintEl = document.getElementById('targetPhrasePreview');
    hintEl.innerText = `"${currentTargetAnswer}"`;
    resetHintForNewQuestion();
    
    const optionsContainer = document.getElementById('optionsContainer');
    optionsContainer.innerHTML = '';
    q.options.forEach((opt, optIdx) => {
        const letter = String.fromCharCode(65 + optIdx);
        const div = document.createElement('div');
        div.className = 'option-item';
        div.innerHTML = `<div class="option-letter">${letter}</div><div class="option-text">${opt}</div>`;
        optionsContainer.appendChild(div);
    });
    document.getElementById('counterDisplay').innerText = `Question ${index+1} / ${QUIZ_DATA.length}`;
    updateRingPercent(0);
    document.getElementById('transcriptBox').innerHTML = '📝 your speech will appear here';
    document.getElementById('levFeedback').innerHTML = '';
    document.getElementById('recordingStatus').innerHTML = '🎤 ready';
    if (recognition && isListening) { try { recognition.abort(); } catch(e) {} isListening = false; }
}

// Speech recognition
function initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        alert("Speech recognition not supported. Please use Chrome, Edge, or Safari.");
        return null;
    }
    const recog = new SpeechRecognition();
    recog.continuous = false;
    recog.interimResults = false;
    recog.lang = 'en-US';
    return recog;
}

function attachRecognitionEvents() {
    if (!recognition) return;
    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        const confidence = event.results[0][0].confidence;
        document.getElementById('transcriptBox').innerHTML = `📢 You said: "${transcript}" ${confidence > 0.7 ? '✅' : '🎧'}`;
        const percent = computeSimilarityPercent(transcript, currentTargetAnswer);
        updateRingPercent(percent);
        
        if (!firstAttemptMade && percent < 100) {
            showHint();
        }
        firstAttemptMade = true;
        
        let feedbackMsg = '';
        if (percent === 100) feedbackMsg = '🎉 Perfect pronunciation! Ring full!';
        else if (percent >= 75) feedbackMsg = `👍 Very good! ${percent}% match.`;
        else if (percent >= 50) feedbackMsg = `📖 ${percent}% accuracy, keep practicing.`;
        else feedbackMsg = `🔊 ${percent}% match — try again.`;
        document.getElementById('levFeedback').innerHTML = `<i class="fas fa-comment-dots"></i> ${feedbackMsg}`;
        document.getElementById('recordingStatus').innerHTML = '✅ Speech captured.';
        
        const currentId = QUIZ_DATA[currentQuestionIndex].id;
        const vocabKey = QUIZ_DATA[currentQuestionIndex].vocabKey;
        sendPronunciationStatement(currentId, vocabKey, transcript, currentTargetAnswer, percent);
        isListening = false;
    };
    recognition.onerror = (event) => {
        console.error(event.error);
        document.getElementById('recordingStatus').innerHTML = `⚠️ Error: ${event.error}`;
        isListening = false;
    };
    recognition.onend = () => { if(!isListening) document.getElementById('recordingStatus').innerHTML = '🎤 ready'; isListening = false; };
}

function startListening() {
    if (!recognition) {
        recognition = initSpeechRecognition();
        if (!recognition) return;
        attachRecognitionEvents();
    }
    if (isListening) return;
    document.getElementById('recordingStatus').innerHTML = '<i class="fas fa-microphone-slash"></i> Listening... speak now!';
    document.getElementById('transcriptBox').innerHTML = '🎙️ listening...';
    recognition.start();
    isListening = true;
}

// Navegación
function nextQuestion() {
    if (currentQuestionIndex + 1 < QUIZ_DATA.length) {
        currentQuestionIndex++;
        loadQuestion(currentQuestionIndex);
    } else {
        document.getElementById('levFeedback').innerHTML = '✨ Quiz completed! ✨ Statements sent to LRS.';
        sendStatement("http://adlnet.gov/expapi/verbs/completed", window.location.href, { completion: true });
    }
}
function prevQuestion() {
    if (currentQuestionIndex > 0) {
        currentQuestionIndex--;
        loadQuestion(currentQuestionIndex);
    }
}

// Iniciar el quiz después de validar el modal
function startQuizWithLearner() {
    console.log("startQuizWithLearner called");
    const nameInput = document.getElementById('learnerName');
    const emailInput = document.getElementById('learnerEmail');
    
    if (!nameInput || !emailInput) {
        console.error("No se encontraron los campos del modal");
        document.getElementById('modalError').innerText = "Error interno: campos no encontrados.";
        return;
    }
    
    const name = nameInput.value.trim();
    const email = emailInput.value.trim();
    
    if (!name || !email) {
        document.getElementById('modalError').innerText = "Debes ingresar nombre y email.";
        return;
    }
    if (!email.includes('@')) {
        document.getElementById('modalError').innerText = "Email inválido.";
        return;
    }
    
    learner.name = name;
    learner.email = email;
    
    // Inicializar LRS (no debe bloquear el inicio del quiz)
    tincan = initXAPI();
    if (tincan) {
        sendStatement("http://adlnet.gov/expapi/verbs/initialized", window.location.href, { completion: false });
    } else {
        console.warn("Continuando sin LRS");
    }
    
    // Ocultar modal y mostrar quiz
    const modal = document.getElementById('learnerModal');
    const quizApp = document.getElementById('quizApp');
    if (modal) modal.style.display = 'none';
    if (quizApp) quizApp.style.display = 'block';
    
    currentQuestionIndex = 0;
    loadQuestion(0);
}

// Event binding con verificación de existencia de elementos
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM ready");
    const startBtn = document.getElementById('startQuizBtn');
    const speakBtn = document.getElementById('speakBtn');
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    
    if (startBtn) {
        startBtn.addEventListener('click', startQuizWithLearner);
    } else {
        console.error("No se encontró el botón 'startQuizBtn'");
    }
    
    if (speakBtn) speakBtn.addEventListener('click', startListening);
    if (prevBtn) prevBtn.addEventListener('click', prevQuestion);
    if (nextBtn) nextBtn.addEventListener('click', nextQuestion);
    
    drawRing(0);
});
