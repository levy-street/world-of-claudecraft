(function () {
  'use strict';

  const data = window.TALENT_LAB_DATA;
  if (!data?.classes) throw new Error('Talent Lab data is unavailable.');

  const classIds = Object.keys(data.classes);
  const state = {
    classId: classIds[0],
    specIndex: 0,
    rotationIndex: -1,
    timer: null,
    talents: Object.fromEntries(classIds.map((classId) => [classId, {}])),
  };

  const elements = {
    actionBar: document.querySelector('#action-bar'),
    buildCount: document.querySelector('#build-count'),
    classDocLink: document.querySelector('#class-doc-link'),
    classMark: document.querySelector('#class-mark'),
    classTabs: document.querySelector('#class-tabs'),
    compareGrid: document.querySelector('#compare-grid'),
    exclusiveList: document.querySelector('#exclusive-list'),
    rotationNext: document.querySelector('#rotation-next'),
    rotationPlay: document.querySelector('#rotation-play'),
    rotationReset: document.querySelector('#rotation-reset'),
    rotationStatus: document.querySelector('#rotation-status'),
    rotationSteps: document.querySelector('#rotation-steps'),
    sharedList: document.querySelector('#shared-list'),
    specDecision: document.querySelector('#spec-decision'),
    specName: document.querySelector('#spec-name'),
    specPicker: document.querySelector('#spec-picker'),
    specResource: document.querySelector('#spec-resource'),
    specRole: document.querySelector('#spec-role'),
    specThesis: document.querySelector('#spec-thesis'),
    talentRows: document.querySelector('#talent-rows'),
  };

  const documentLinks = {
    hunter: '../../docs/design/hunter-v028-class-design.md',
    shaman: '../../docs/design/shaman-v028-class-design.md',
    priest: '../../docs/design/priest-v028-class-design.md',
  };

  function currentClass() {
    return data.classes[state.classId];
  }

  function currentSpec() {
    return currentClass().specs[state.specIndex];
  }

  function stopRotation() {
    if (state.timer !== null) window.clearInterval(state.timer);
    state.timer = null;
    elements.rotationPlay.textContent = 'Play loop';
    elements.rotationPlay.setAttribute('aria-pressed', 'false');
  }

  function resetRotation() {
    stopRotation();
    state.rotationIndex = -1;
    updateRotationState();
  }

  function stepRotation() {
    const loop = currentSpec().loop;
    state.rotationIndex = (state.rotationIndex + 1) % loop.length;
    updateRotationState();
  }

  function playRotation() {
    if (state.timer !== null) {
      stopRotation();
      return;
    }

    if (state.rotationIndex >= currentSpec().loop.length - 1) state.rotationIndex = -1;
    stepRotation();
    elements.rotationPlay.textContent = 'Pause loop';
    elements.rotationPlay.setAttribute('aria-pressed', 'true');
    state.timer = window.setInterval(stepRotation, 1350);
  }

  function listItems(items) {
    return items.map((item) => `<li>${item}</li>`).join('');
  }

  function renderClassTabs() {
    elements.classTabs.innerHTML = classIds
      .map((classId) => {
        const cls = data.classes[classId];
        const selected = classId === state.classId;
        return `
          <button
            type="button"
            class="class-tab"
            data-class-id="${classId}"
            aria-selected="${selected}"
            tabindex="${selected ? 0 : -1}"
          >
            <span aria-hidden="true">${cls.mark}</span>
            ${cls.name}
          </button>
        `;
      })
      .join('');
  }

  function renderSpecPicker() {
    elements.specPicker.innerHTML = currentClass()
      .specs.map(
        (spec, index) => `
          <button
            type="button"
            class="spec-button"
            data-spec-index="${index}"
            aria-pressed="${index === state.specIndex}"
          >
            ${spec.name}
            <small>${spec.role}</small>
          </button>
        `,
      )
      .join('');
  }

  function renderSpec() {
    const cls = currentClass();
    const spec = currentSpec();
    document.body.dataset.class = state.classId;
    document.documentElement.style.setProperty('--accent', cls.color);
    document.documentElement.style.setProperty('--accent-soft', cls.softColor);
    elements.classMark.textContent = cls.mark;
    elements.specRole.textContent = spec.role;
    elements.specName.textContent = spec.name;
    elements.specThesis.textContent = spec.thesis;
    elements.specDecision.textContent = spec.decision;
    elements.specResource.textContent = spec.resource;
    elements.exclusiveList.innerHTML = listItems(spec.exclusive);
    elements.sharedList.innerHTML = listItems(cls.shared.slice(0, 6));
    elements.classDocLink.href = documentLinks[state.classId];
    elements.classDocLink.textContent = `${cls.name} design`;
  }

  function renderRotation() {
    const spec = currentSpec();
    elements.rotationSteps.innerHTML = spec.loop
      .map(
        ([name, description], index) => `
          <li class="rotation-step" data-rotation-index="${index}">
            <div>
              <strong>${name}</strong>
              <p>${description}</p>
            </div>
          </li>
        `,
      )
      .join('');

    elements.actionBar.innerHTML = spec.actions
      .map(
        ([name, kind]) => `
          <div class="action ${kind}" data-action-name="${name}">
            <strong>${name}</strong>
          </div>
        `,
      )
      .join('');

    updateRotationState();
  }

  function updateRotationState() {
    const spec = currentSpec();
    const stepElements = elements.rotationSteps.querySelectorAll('.rotation-step');
    const actionElements = elements.actionBar.querySelectorAll('.action');
    stepElements.forEach((step, index) => step.classList.toggle('active', index === state.rotationIndex));

    const activeName = state.rotationIndex >= 0 ? spec.loop[state.rotationIndex][0] : null;
    actionElements.forEach((action) => {
      const actionName = action.dataset.actionName;
      const isRelated =
        activeName !== null &&
        (actionName === activeName || activeName.includes(actionName) || actionName.includes(activeName));
      action.classList.toggle('active', isRelated);
    });

    elements.rotationStatus.textContent =
      state.rotationIndex < 0
        ? 'Ready to begin'
        : `${state.rotationIndex + 1} of ${spec.loop.length}: ${spec.loop[state.rotationIndex][0]}`;
  }

  function renderTalents() {
    const cls = currentClass();
    const selections = state.talents[state.classId];
    elements.talentRows.innerHTML = cls.talents
      .map(
        (row) => `
          <article class="talent-row">
            <div class="talent-level">
              <strong>${row.level}</strong>
              <span>${row.theme}</span>
            </div>
            <div class="talent-options" role="group" aria-label="Level ${row.level} ${row.theme}">
              ${row.options
                .map(
                  ([name, description], optionIndex) => `
                    <button
                      type="button"
                      class="talent-option"
                      data-talent-level="${row.level}"
                      data-option-index="${optionIndex}"
                      aria-pressed="${selections[row.level] === optionIndex}"
                    >
                      <strong>${name}</strong>
                      <span>${description}</span>
                    </button>
                  `,
                )
                .join('')}
            </div>
          </article>
        `,
      )
      .join('');
    updateBuildCount();
  }

  function updateBuildCount() {
    const selected = Object.keys(state.talents[state.classId]).length;
    elements.buildCount.textContent = `${selected} / ${currentClass().talents.length} selected`;
  }

  function renderComparison() {
    const cls = currentClass();
    elements.compareGrid.innerHTML = cls.specs
      .map(
        (spec, index) => `
          <article class="compare-card ${index === state.specIndex ? 'active' : ''}">
            <h3>${spec.name}</h3>
            <p class="role">${spec.role}</p>
            <p>${spec.decision}</p>
          </article>
        `,
      )
      .join('');
  }

  function renderAll() {
    renderClassTabs();
    renderSpecPicker();
    renderSpec();
    renderRotation();
    renderTalents();
    renderComparison();
  }

  function selectClass(classId) {
    if (!data.classes[classId] || classId === state.classId) return;
    stopRotation();
    state.classId = classId;
    state.specIndex = 0;
    state.rotationIndex = -1;
    renderAll();
  }

  function selectSpec(index) {
    const validIndex = Number(index);
    if (!currentClass().specs[validIndex] || validIndex === state.specIndex) return;
    stopRotation();
    state.specIndex = validIndex;
    state.rotationIndex = -1;
    renderSpecPicker();
    renderSpec();
    renderRotation();
    renderComparison();
  }

  elements.classTabs.addEventListener('click', (event) => {
    const button = event.target.closest('[data-class-id]');
    if (button) selectClass(button.dataset.classId);
  });

  elements.classTabs.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    const currentIndex = classIds.indexOf(state.classId);
    const nextIndex = (currentIndex + direction + classIds.length) % classIds.length;
    selectClass(classIds[nextIndex]);
    elements.classTabs.querySelector('[aria-selected="true"]')?.focus();
  });

  elements.specPicker.addEventListener('click', (event) => {
    const button = event.target.closest('[data-spec-index]');
    if (button) selectSpec(button.dataset.specIndex);
  });

  elements.talentRows.addEventListener('click', (event) => {
    const button = event.target.closest('[data-talent-level]');
    if (!button) return;
    const level = button.dataset.talentLevel;
    const optionIndex = Number(button.dataset.optionIndex);
    state.talents[state.classId][level] = optionIndex;
    const row = button.closest('.talent-row');
    row.querySelectorAll('.talent-option').forEach((option) =>
      option.setAttribute('aria-pressed', String(option === button)),
    );
    updateBuildCount();
  });

  elements.rotationReset.addEventListener('click', resetRotation);
  elements.rotationNext.addEventListener('click', () => {
    stopRotation();
    stepRotation();
  });
  elements.rotationPlay.addEventListener('click', playRotation);

  renderAll();
})();
