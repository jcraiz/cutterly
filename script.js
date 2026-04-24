// =========================== CONFIGURATION ===========================
const LRS_CONFIG = {
    endpoint: "https://armada-lrs.lrs.io/xapi/", // Change this to your LRS
    auth: "Basic " + btoa("123456:123456")        // Change to your key:secret
};

const QUIZ_DATA = [
    { id: 1, text: "What do you use to cut meat?", icon: "🥩", options: ["I use a knife.", "I use a fork.", "I use a towel."], correctAnswer: "I use a knife." },
    { id: 2, text: "What do you use to eat soup?", icon: "🥣", options: ["I use a spoon.", "I use a fork.", "I use chopsticks."], correctAnswer: "I use a spoon." },
    { id: 3, text: "What do you use to spread butter?", icon: "🍞", options: ["I use a butter knife.", "I use a spatula.", "I use a ladle."], correctAnswer: "I use a butter knife." },
    { id: 4, text: "What do you use to flip pancakes?", icon: "🥞", options: ["I use a spatula.", "I use a whisk.", "I use tongs."], correctAnswer: "I use a spatula." },
    { id: 5, text: "What do you use to measure ingredients?", icon: "🥄", options: ["I use measuring spoons.", "I use a cup.", "I use a scale."], correctAnswer: "I use measuring spoons." }
];

// =========================== STATE ===========================
let currentUser = { name: "", email: "" };
let sessionId = "sess-" + Date.now();
let currentQuestionIndex = 0;
let recognition = null;
let isRecording = false;
let stats = { total: 0, correct: 0 };

// =========================== LRS LOGIC (NAUTICAL STYLE) ===========================
async function sendXAPI(statement) {
    try {
        const response = await fetch(LRS_CONFIG.endpoint + 'statements', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': LRS_CONFIG.auth,
                'X-Experience-API-Version': '1.0.3'
            },
            body: JSON.stringify(statement)
        });
        if (response.ok) document.getElementById('lrs-status').classList.add('active');
    } catch (e) { console.error("LRS Error", e); }
}

function getBaseStatement(verbName, verbId) {
    return {
        actor: { name: currentUser.name, mbox: "mailto:" + currentUser.email },
        verb: { id: verbId, display: { "en-US": verbName } },
        timestamp: new Date().toISOString(),
        context: { extensions: { "https://lab.edu/session": sessionId } }
    };
}

// =========================== SPEECH LOGIC ===========================
function calculateSimilarity(str1, str2) {
    const n = (s) => s.toLowerCase().replace(/[^\w\s]/g, '').trim();
    const a = n(str1), b = n(str2);
    const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));
    for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= b.length; j++) matrix[j][0] = j;
    for (let j = 1; j <= b.length; j++) {
        for (let i = 1; i <= a.length; i++) {
            const cost = a[i-1] === b[j-1] ? 0 : 1;
            matrix[j][i] = Math.min(matrix[j][i-1]+1, matrix[j-1][i]+1, matrix[j-1][i-1]+cost);
        }
    }
    return Math.round((1 - matrix[b.length][a.length] / Math.max(a.length, b.length)) * 100);
}

function initSpeech() {
    const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Speech) return;
    recognition = new Speech();
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 3; // Nautical logic: check multiple guesses

    recognition.onstart = () => {
        isRecording = true;
        document.getElementById('record-btn').classList.add('recording');
        document.getElementById('status-text').innerText = "Listening...";
    };

    recognition.onresult = (event) => {
        const alternatives = event.results[0];
        const target = QUIZ_DATA[currentQuestionIndex].correctAnswer;
        
        // Nautical strategy: Find the best match among alternatives
        let bestScore = 0;
        let bestTranscript = alternatives[0].transcript;

        for (let i = 0; i < alternatives.length; i++) {
            let s = calculateSimilarity(alternatives[i].transcript, target);
            if (s > bestScore) {
                bestScore = s;
                bestTranscript = alternatives[i].transcript;
            }
        }

        handleSpeechResult(bestTranscript, bestScore);
    };

    recognition.onend = () => {
        isRecording = false;
        document.getElementById('record-btn').classList.remove('recording');
        document.getElementById('status-text').innerText = "🎤 ready";
    };
}

function handleSpeechResult(spoken, score) {
    document.getElementById('transcriptBox').innerText = `"${spoken}"`;
    drawRing(score);
    
    const isCorrect = score >= 80;
    stats.total++;
    if (isCorrect) stats.correct++;
    updateDashboard();

    if (score < 90) document.getElementById('targetPhrasePreview').style.display = 'block';

    // Send Answer Statement
    let stmt = getBaseStatement("answered", "http://adlnet.gov/expapi/verbs/answered");
    stmt.object = { id: "https://lab.edu/cutlery/q" + QUIZ_DATA[currentQuestionIndex].id };
    stmt.result = {
        success: isCorrect,
        score: { scaled: score/100, raw: score },
        response: spoken
    };
    sendXAPI(stmt);
}

// =========================== UI & NAV ===========================
function drawRing(percent) {
    const canvas = document.getElementById('ringCanvas');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 140, 140);
    ctx.beginPath(); ctx.arc(70, 70, 60, 0, 2*Math.PI);
    ctx.strokeStyle = "#eee"; ctx.lineWidth = 10; ctx.stroke();
    ctx.beginPath(); ctx.arc(70, 70, 60, -Math.PI/2, (-Math.PI/2) + (percent/100 * 2*Math.PI));
    ctx.strokeStyle = percent > 80 ? "#4CAF50" : (percent > 40 ? "#FFC107" : "#F44336");
    ctx.lineWidth = 10; ctx.lineCap = "round"; ctx.stroke();
    document.getElementById('ringPercentText').innerText = percent + "%";
}

function updateDashboard() {
    document.getElementById('correct-count').innerText = stats.correct;
    const rate = stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0;
    document.getElementById('accuracy-rate').innerText = rate + "%";
}

function loadQuestion(index) {
    const q = QUIZ_DATA[index];
    document.getElementById('questionText').innerText = q.text;
    document.getElementById('questionIcon').innerText = q.icon;
    document.getElementById('targetText').innerText = q.correctAnswer;
    document.getElementById('targetPhrasePreview').style.display = 'none';
    document.getElementById('counterDisplay').innerText = `${index+1} / ${QUIZ_DATA.length}`;
    
    const container = document.getElementById('optionsContainer');
    container.innerHTML = '';
    q.options.forEach((opt, i) => {
        const div = document.createElement('div');
        div.className = 'option-item';
        div.innerHTML = `<span class="option-letter">${String.fromCharCode(65+i)}</span><span>${opt}</span>`;
        container.appendChild(div);
    });
    drawRing(0);
}

// =========================== INIT ===========================
window.onload = () => {
    initSpeech();

    document.getElementById('startBtn').onclick = () => {
        const n = document.getElementById('userName').value.trim();
        const e = document.getElementById('userEmail').value.trim();
        if (!n || !e.includes('@')) return alert("Enter valid Name and Email");
        
        currentUser = { name: n, email: e };
        document.getElementById('learnerModal').style.display = 'none';
        document.getElementById('quizApp').style.display = 'block';
        
        let stmt = getBaseStatement("initialized", "http://adlnet.gov/expapi/verbs/initialized");
        stmt.object = { id: "https://lab.edu/cutlery/quiz" };
        sendXAPI(stmt);
        loadQuestion(0);
    };

    document.getElementById('record-btn').onclick = () => {
        if (!isRecording) recognition.start();
    };

    document.getElementById('nextBtn').onclick = () => {
        if (currentQuestionIndex < QUIZ_DATA.length - 1) {
            currentQuestionIndex++;
            loadQuestion(currentQuestionIndex);
        }
    };

    document.getElementById('prevBtn').onclick = () => {
        if (currentQuestionIndex > 0) {
            currentQuestionIndex--;
            loadQuestion(currentQuestionIndex);
        }
    };

    document.getElementById('end-session-btn').onclick = () => {
        let stmt = getBaseStatement("completed", "http://adlnet.gov/expapi/verbs/completed");
        stmt.object = { id: "https://lab.edu/cutlery/quiz" };
        stmt.result = { score: { scaled: stats.correct/QUIZ_DATA.length } };
        sendXAPI(stmt);
        location.reload();
    };
};
