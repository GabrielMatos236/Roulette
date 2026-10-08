(() => {
  'use strict';

  /* ---------- Configuração ---------- */
  const storageKey = 'roletaTv.v1';
  const minItems = 2;
  const maxItems = 100;
  const denseThreshold = 24;   // acima disso a roleta fica "densa": fonte e linhas menores
  const svgNs = 'http://www.w3.org/2000/svg';

  const wheelRadius = 96;
  const labelOuterRadius = 85;                 // onde o texto termina (perto da borda)
  const labelMaxLength = labelOuterRadius - 24; // espaço útil até o miolo
  const minLabelSize = 4.2;
  const minLabelSizeDense = 2.4;

  // Ordem pensada pra vizinhos sempre contrastarem (inclusive o último com o primeiro)
  const palette = [
    { fill: '#FFD23F', ink: '#17123A' }, // amarelo
    { fill: '#F0479B', ink: '#17123A' }, // magenta
    { fill: '#2EC4F1', ink: '#17123A' }, // ciano
    { fill: '#FF5A3C', ink: '#17123A' }, // vermelho
    { fill: '#3DDC84', ink: '#17123A' }, // verde
    { fill: '#3F5BF0', ink: '#FFFFFF' }, // azul
    { fill: '#FF9A1F', ink: '#17123A' }, // laranja
    { fill: '#8A4FE0', ink: '#FFFFFF' }  // roxo
  ];

  const defaultState = {
    wheelName: 'O que assistir hoje?',
    items: ['Filme antigo', 'Série nova', 'Lançamento', 'Clássico', 'Documentário', 'Animação']
  };

  /* ---------- Elementos ---------- */
  const rootEl = document.documentElement;
  const wheelTitle = document.getElementById('wheelTitle');
  const wheelEl = document.getElementById('wheel');
  const sliceLayer = document.getElementById('sliceLayer');
  const labelLayer = document.getElementById('labelLayer');
  const spinButton = document.getElementById('spinButton');
  const liveRegion = document.getElementById('liveRegion');
  const settingsFields = document.getElementById('settingsFields');
  const wheelNameInput = document.getElementById('wheelNameInput');
  const itemCountInput = document.getElementById('itemCountInput');
  const decreaseButton = document.getElementById('decreaseButton');
  const increaseButton = document.getElementById('increaseButton');
  const itemList = document.getElementById('itemList');
  const resultEl = document.getElementById('result');
  const resultCard = document.getElementById('resultCard');
  const resultName = document.getElementById('resultName');
  const spinAgainButton = document.getElementById('spinAgainButton');
  const removeWinnerButton = document.getElementById('removeWinnerButton');
  const closeResultButton = document.getElementById('closeResultButton');

  const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* ---------- Som do giro ---------- */
  const defaultSpinDurationMs = 5200;       // usado se o áudio não carregar
  const spinSound = new Audio('spin.mp3');
  spinSound.preload = 'auto';

  // O giro dura exatamente o tempo do áudio, então os dois terminam juntos
  function spinDurationFromSound() {
    const seconds = spinSound.duration;
    return Number.isFinite(seconds) && seconds > 0
      ? Math.round(seconds * 1000)
      : defaultSpinDurationMs;
  }

  function playSpinSound() {
    try {
      spinSound.currentTime = 0;
      const playing = spinSound.play();
      if (playing && typeof playing.catch === 'function') {
        playing.catch(() => { /* navegador bloqueou ou arquivo ausente: a roleta gira igual */ });
      }
    } catch (error) { /* som é só um complemento */ }
  }

  function stopSpinSound() {
    try {
      spinSound.pause();
      spinSound.currentTime = 0;
    } catch (error) { /* idem */ }
  }

  /* ---------- Estado ---------- */
  let state = loadState() || structuredCloneSafe(defaultState);
  let rotation = 0;          // graus acumulados da roleta
  let isSpinning = false;
  let winnerIndex = -1;

  function structuredCloneSafe(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.items)) return null;
      const items = parsed.items
        .filter((item) => typeof item === 'string')
        .slice(0, maxItems);
      while (items.length < minItems) items.push('');
      return {
        wheelName: typeof parsed.wheelName === 'string' ? parsed.wheelName : '',
        items
      };
    } catch (error) {
      return null; // storage indisponível ou dado corrompido: segue com o padrão
    }
  }

  function saveState() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
    } catch (error) {
      /* sem storage a roleta funciona igual, só não lembra na próxima visita */
    }
  }

  /* ---------- Helpers ---------- */
  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function itemLabel(index) {
    const name = state.items[index].trim();
    return name || `Item ${index + 1}`;
  }

  function colorFor(index, total) {
    // Se sobrar 1 no ciclo da paleta, o último ficaria igual ao primeiro: troca a cor dele
    if (total > 1 && total % palette.length === 1 && index === total - 1) {
      return palette[2];
    }
    return palette[index % palette.length];
  }

  function maxLabelSizeFor(total) {
    if (total <= 4) return 11;
    if (total <= 8) return 9.5;
    if (total <= 12) return 8;
    if (total <= 16) return 6.6;
    if (total <= 20) return 5.6;
    if (total <= denseThreshold) return 4.8;
    // Roleta densa: a fonte acompanha a largura da fatia (~raio 72), sem passar de 4.8
    const sliceWidth = (Math.PI * 2 * 72) / total;
    return clamp(sliceWidth * 0.75, minLabelSizeDense, 4.8);
  }

  // Encolhe a fonte até caber; se nem assim couber, corta com reticências
  function fitLabel(textEl, name, maxSize, floorSize) {
    textEl.textContent = name;
    textEl.setAttribute('font-size', maxSize);
    let length = textEl.getComputedTextLength();
    if (length <= labelMaxLength) return;

    const size = Math.max(floorSize, (maxSize * labelMaxLength) / length);
    textEl.setAttribute('font-size', size.toFixed(2));
    length = textEl.getComputedTextLength();

    let shown = name;
    while (length > labelMaxLength && shown.length > 1) {
      shown = shown.slice(0, -1);
      textEl.textContent = shown.trimEnd() + '…';
      length = textEl.getComputedTextLength();
    }
  }

  /* ---------- Renderização ---------- */
  function renderTitle() {
    const name = state.wheelName.trim() || 'Roleta';
    wheelTitle.textContent = name;
    document.title = name;
  }

  function renderWheel() {
    const total = state.items.length;
    const sliceAngle = (Math.PI * 2) / total;
    const maxSize = maxLabelSizeFor(total);
    const isDense = total > denseThreshold;
    const floorSize = isDense ? Math.min(minLabelSizeDense, maxSize) : minLabelSize;
    const sliceStroke = isDense ? Math.max(0.2, 0.8 - (total - denseThreshold) * 0.008) : 0.8;

    sliceLayer.replaceChildren();
    labelLayer.replaceChildren();

    for (let index = 0; index < total; index++) {
      // Pedaço 0 começa no topo (-90°) e os outros seguem no sentido horário
      const startAngle = index * sliceAngle - Math.PI / 2;
      const endAngle = startAngle + sliceAngle;
      const { fill, ink } = colorFor(index, total);

      const x1 = (Math.cos(startAngle) * wheelRadius).toFixed(3);
      const y1 = (Math.sin(startAngle) * wheelRadius).toFixed(3);
      const x2 = (Math.cos(endAngle) * wheelRadius).toFixed(3);
      const y2 = (Math.sin(endAngle) * wheelRadius).toFixed(3);

      const slice = document.createElementNS(svgNs, 'path');
      slice.setAttribute('class', 'slice');
      slice.setAttribute('d', `M0 0 L${x1} ${y1} A${wheelRadius} ${wheelRadius} 0 0 1 ${x2} ${y2} Z`);
      slice.style.setProperty('--slice-fill', fill);
      if (isDense) slice.style.strokeWidth = sliceStroke.toFixed(2);
      sliceLayer.appendChild(slice);

      const midDegrees = ((startAngle + endAngle) / 2) * (180 / Math.PI);
      const label = document.createElementNS(svgNs, 'text');
      label.setAttribute('class', 'label');
      label.setAttribute('transform', `rotate(${midDegrees.toFixed(3)})`);
      label.setAttribute('x', labelOuterRadius);
      label.setAttribute('text-anchor', 'end');
      label.setAttribute('dy', '0.35em');
      label.style.setProperty('--label-ink', ink);
      labelLayer.appendChild(label);
      fitLabel(label, itemLabel(index), maxSize, floorSize);
    }
  }

  function renderItemList() {
    const total = state.items.length;
    itemList.replaceChildren();

    state.items.forEach((name, index) => {
      const row = document.createElement('li');
      row.className = 'item-row';

      const dot = document.createElement('span');
      dot.className = 'item-dot';
      dot.style.background = colorFor(index, total).fill;
      dot.setAttribute('aria-hidden', 'true');

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'text-input item-input';
      input.maxLength = 60;
      input.value = name;
      input.placeholder = `Item ${index + 1}`;
      input.autocomplete = 'off';
      input.enterKeyHint = 'next';
      input.dataset.index = index;
      input.setAttribute('aria-label', `Nome do item ${index + 1}`);

      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.className = 'item-remove';
      removeButton.textContent = '×';
      removeButton.dataset.index = index;
      removeButton.disabled = total <= minItems;
      removeButton.setAttribute('aria-label', `Remover ${itemLabel(index)}`);

      row.append(dot, input, removeButton);
      itemList.appendChild(row);
    });

    itemCountInput.value = total;
    decreaseButton.disabled = total <= minItems;
    increaseButton.disabled = total >= maxItems;
  }

  function renderAll() {
    renderTitle();
    renderItemList();
    renderWheel();
  }

  /* ---------- Edição ---------- */
  function setItemCount(rawCount) {
    const parsedCount = Number.parseInt(rawCount, 10);
    const count = clamp(Number.isNaN(parsedCount) ? state.items.length : parsedCount, minItems, maxItems);
    while (state.items.length < count) state.items.push('');
    state.items.length = count;
    saveState();
    renderItemList();
    renderWheel();
  }

  function removeItem(index) {
    if (state.items.length <= minItems) return;
    state.items.splice(index, 1);
    saveState();
    renderItemList();
    renderWheel();
  }

  wheelNameInput.addEventListener('input', () => {
    state.wheelName = wheelNameInput.value;
    saveState();
    renderTitle();
  });

  wheelNameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') wheelNameInput.blur();
  });

  decreaseButton.addEventListener('click', () => setItemCount(state.items.length - 1));
  increaseButton.addEventListener('click', () => setItemCount(state.items.length + 1));
  itemCountInput.addEventListener('change', () => setItemCount(itemCountInput.value));

  itemList.addEventListener('input', (event) => {
    const input = event.target.closest('.item-input');
    if (!input) return;
    state.items[Number(input.dataset.index)] = input.value;
    saveState();
    renderWheel(); // só a roleta: recriar a lista aqui tiraria o foco do campo
  });

  // Enter pula pro próximo item; no último, cria um novo
  itemList.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    const input = event.target.closest('.item-input');
    if (!input) return;
    event.preventDefault();

    const nextIndex = Number(input.dataset.index) + 1;
    if (nextIndex >= state.items.length) {
      if (state.items.length >= maxItems) {
        input.blur();
        return;
      }
      setItemCount(state.items.length + 1);
    }
    const nextInput = itemList.querySelector(`.item-input[data-index="${nextIndex}"]`);
    if (nextInput) nextInput.focus();
  });

  itemList.addEventListener('click', (event) => {
    const removeButton = event.target.closest('.item-remove');
    if (!removeButton) return;
    removeItem(Number(removeButton.dataset.index));
  });

  /* ---------- Giro ---------- */
  function clearWinnerHighlight() {
    wheelEl.classList.remove('is-settled');
    wheelEl.querySelectorAll('.is-winner').forEach((el) => el.classList.remove('is-winner'));
  }

  function spin() {
    if (isSpinning) return;

    const total = state.items.length;
    const sliceDegrees = 360 / total;
    const reducedMotion = reducedMotionQuery.matches;
    const spinDurationMs = reducedMotion ? 700 : spinDurationFromSound();
    const blinkDurationMs = reducedMotion ? 600 : 1700;

    isSpinning = true;
    clearWinnerHighlight();
    spinButton.disabled = true;
    spinButton.textContent = 'Girando…';
    settingsFields.disabled = true;

    // 1) Sorteia o vencedor primeiro; 2) calcula o ângulo que coloca ele embaixo da seta
    winnerIndex = Math.floor(Math.random() * total);
    const offsetInSlice = sliceDegrees * (0.15 + Math.random() * 0.7); // nunca em cima da linha
    const landingAngle = winnerIndex * sliceDegrees + offsetInSlice;   // horário, a partir do topo

    const currentMod = ((rotation % 360) + 360) % 360;
    const targetMod = (360 - landingAngle) % 360;
    let delta = targetMod - currentMod;
    if (delta < 0) delta += 360;

    const fullTurns = reducedMotion ? 1 : 5 + Math.floor(Math.random() * 3);
    rotation += fullTurns * 360 + delta;

    // Som e animação disparam no mesmo instante (dentro do clique, que o navegador exige pra tocar áudio)
    if (!reducedMotion) playSpinSound();
    wheelEl.style.transition = `transform ${spinDurationMs}ms cubic-bezier(0.12, 0.62, 0.08, 1)`;
    wheelEl.style.transform = `rotate(${rotation}deg)`;

    window.setTimeout(() => {
      settleOnWinner();
      window.setTimeout(openResult, blinkDurationMs);
    }, spinDurationMs + 60);
  }

  function settleOnWinner() {
    const slice = sliceLayer.children[winnerIndex];
    const label = labelLayer.children[winnerIndex];
    if (slice) slice.classList.add('is-winner');
    if (label) label.classList.add('is-winner');
    wheelEl.classList.add('is-settled');

    try {
      if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
    } catch (error) { /* vibração é só um mimo */ }
  }

  /* ---------- Resultado ---------- */
  function openResult() {
    const total = state.items.length;
    const name = itemLabel(winnerIndex);
    const { fill, ink } = colorFor(winnerIndex, total);

    resultCard.style.setProperty('--card-bg', fill);
    resultCard.style.setProperty('--card-ink', ink);
    resultName.textContent = name;
    resultName.classList.toggle('is-long', name.length > 22);
    removeWinnerButton.hidden = total <= minItems;

    resultEl.hidden = false;
    rootEl.classList.add('is-locked');
    liveRegion.textContent = `Caiu em ${name}`;
    spinAgainButton.focus();
  }

  function closeResult() {
    stopSpinSound();
    resultEl.hidden = true;
    rootEl.classList.remove('is-locked');
    clearWinnerHighlight();

    isSpinning = false;
    spinButton.disabled = false;
    spinButton.textContent = 'Girar';
    settingsFields.disabled = false;
  }

  spinButton.addEventListener('click', spin);

  spinAgainButton.addEventListener('click', () => {
    closeResult();
    spin();
  });

  removeWinnerButton.addEventListener('click', () => {
    const removedIndex = winnerIndex;
    closeResult();
    removeItem(removedIndex);
    spinButton.focus();
  });

  closeResultButton.addEventListener('click', () => {
    closeResult();
    spinButton.focus();
  });

  // Tocar fora da caixa também fecha
  resultEl.addEventListener('click', (event) => {
    if (event.target === resultEl) {
      closeResult();
      spinButton.focus();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !resultEl.hidden) {
      closeResult();
      spinButton.focus();
    }
  });

  /* ---------- Início ---------- */
  wheelNameInput.value = state.wheelName;
  renderAll();

  // Quando as fontes terminam de carregar a largura do texto muda: mede de novo
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      if (!isSpinning) renderWheel();
    });
  }
})();
