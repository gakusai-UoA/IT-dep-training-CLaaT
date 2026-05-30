/* playground.js */
(function() {
  let drawerElement = null;
  let backdropElement = null;
  let monacoEditorInstance = null;
  let currentPlayground = null;
  let monacoLoadedPromise = null;
  
  const activePlaygrounds = [];
  let isMonacoInitializedGlobal = false;
  let monacoGlobalRef = null;

  function loadTypeScriptIfNeeded() {
    if (typeof ts !== 'undefined') return;
    if (document.querySelector('script[src*="typescript.min.js"]')) return;
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/typescript/5.0.4/typescript.min.js';
    script.async = true;
    document.head.appendChild(script);
  }

  function loadMonaco() {
    if (monacoLoadedPromise) return monacoLoadedPromise;
    monacoLoadedPromise = new Promise((resolve, reject) => {
      if (typeof monaco !== 'undefined') {
        resolve(monaco);
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.39.0/min/vs/loader.min.js';
      script.onload = () => {
        require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.39.0/min/vs' } });
        require(['vs/editor/editor.main'], function() {
          monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
            diagnosticCodesToIgnore: [2300, 2393, 2451]
          });
          monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
            diagnosticCodesToIgnore: [2300, 2393, 2451]
          });
          resolve(monaco);
        }, function(err) {
          reject(err);
        });
      };
      script.onerror = (err) => reject(err);
      document.head.appendChild(script);
    });
    return monacoLoadedPromise;
  }

  function handleMonacoLoaded(monaco) {
    monacoGlobalRef = monaco;
    isMonacoInitializedGlobal = true;
    activePlaygrounds.forEach(playground => {
      if (!playground.monacoEditor) {
        initInlineMonaco(playground, monaco);
      }
    });
  }

  function initInlineMonaco(playground, monaco) {
    const inlineDiv = document.createElement('div');
    inlineDiv.className = 'playground-monaco-inline';
    playground.editorWrapper.appendChild(inlineDiv);

    // Hide fallback textarea
    playground.textarea.classList.add('hidden');

    const model = monaco.editor.createModel(playground.textarea.value, playground.lang);
    
    const editor = monaco.editor.create(inlineDiv, {
      model: model,
      theme: 'vs-dark',
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 14,
      fontFamily: 'SFMono-Regular, Consolas, "Liberation Mono", Menlo, Courier, monospace',
      lineNumbers: 'on',
      roundedSelection: false,
      scrollBeyondLastLine: false,
      readOnly: false,
      cursorStyle: 'line',
      folding: true,
      tabSize: 2,
      insertSpaces: true,
      scrollbar: {
        vertical: 'hidden',
        horizontal: 'auto',
        handleMouseWheel: false
      }
    });

    // Intercept and disable Ctrl+S / Cmd+S save action
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      // Do nothing, preventing browser save dialog
    });

    // Auto-grow inline editor height based on content
    const updateHeight = () => {
      const contentHeight = editor.getContentHeight();
      inlineDiv.style.height = `${contentHeight * 2}px`;
      editor.layout();
    };
    editor.onDidContentSizeChange(updateHeight);
    updateHeight();

    // Sync content to textarea in real-time (for backup/reset operations)
    model.onDidChangeContent(() => {
      playground.textarea.value = editor.getValue();
    });

    playground.monacoEditor = editor;
    playground.monacoModel = model;
  }

  function ensureDrawerCreated() {
    if (drawerElement) return;

    // Backdrop
    backdropElement = document.createElement('div');
    backdropElement.className = 'drawer-backdrop';
    document.body.appendChild(backdropElement);

    // Drawer Container
    drawerElement = document.createElement('div');
    drawerElement.className = 'editor-drawer';
    drawerElement.innerHTML = `
      <div class="drawer-header">
        <div class="drawer-title">
          <span class="drawer-filename">code.js</span>
        </div>
        <button class="drawer-close-btn">&times;</button>
      </div>
      <div class="monaco-container-wrapper">
        <div class="monaco-loader">Loading VS Code Editor...</div>
        <div id="monaco-container"></div>
      </div>
      <div class="drawer-banner"></div>
      <div class="drawer-console">
        <div class="console-header">
          <span>Console Output</span>
          <button class="playground-btn clear-console-btn" style="padding: 2px 8px; font-size: 0.75em; border-radius: 3px;">Clear</button>
        </div>
        <div class="console-body"></div>
      </div>
      <div class="drawer-actions">
        <button class="playground-btn reset-btn">Reset</button>
        <button class="playground-btn run-btn">Run (Ctrl+Enter)</button>
      </div>
    `;
    document.body.appendChild(drawerElement);

    // Close actions
    drawerElement.querySelector('.drawer-close-btn').addEventListener('click', closeMonacoDrawer);
    backdropElement.addEventListener('click', closeMonacoDrawer);

    // Clear console inside drawer
    drawerElement.querySelector('.clear-console-btn').addEventListener('click', () => {
      drawerElement.querySelector('.console-body').innerHTML = '';
    });

    // Reset inside drawer
    drawerElement.querySelector('.drawer-actions .reset-btn').addEventListener('click', () => {
      if (currentPlayground && monacoEditorInstance) {
        monacoEditorInstance.setValue(currentPlayground.cleanedOriginalCode);
        currentPlayground.resetInline();
        drawerElement.querySelector('.drawer-banner').style.display = 'none';
        drawerElement.querySelector('.console-body').innerHTML = '';
      }
    });

    // Run inside drawer
    drawerElement.querySelector('.drawer-actions .run-btn').addEventListener('click', () => {
      if (currentPlayground && monacoEditorInstance) {
        const code = monacoEditorInstance.getValue();
        const consoleEls = [
          currentPlayground.consoleArea,
          drawerElement.querySelector('.console-body')
        ];
        const bannerEls = [
          currentPlayground.banner,
          drawerElement.querySelector('.drawer-banner')
        ];
        runCodeUnified(
          code,
          currentPlayground.tests,
          currentPlayground.lang === 'typescript',
          consoleEls,
          bannerEls,
          currentPlayground
        );
      }
    });
  }

  function openMonacoDrawer(playground) {
    ensureDrawerCreated();
    currentPlayground = playground;

    drawerElement.classList.add('open');
    backdropElement.classList.add('open');

    // Customize title tab filename
    const extension = playground.lang === 'typescript' ? 'ts' : 'js';
    drawerElement.querySelector('.drawer-filename').textContent = `exercise.${extension}`;

    // Reset drawer state
    drawerElement.querySelector('.drawer-banner').style.display = 'none';
    drawerElement.querySelector('.console-body').innerHTML = '';

    const loader = drawerElement.querySelector('.monaco-loader');
    const container = document.getElementById('monaco-container');
    loader.style.display = 'block';
    container.style.opacity = '0';

    loadMonaco().then(monaco => {
      loader.style.display = 'none';
      container.style.opacity = '1';

      if (!monacoEditorInstance) {
        monacoEditorInstance = monaco.editor.create(container, {
          theme: 'vs-dark',
          automaticLayout: true,
          minimap: { enabled: false },
          fontSize: 14,
          fontFamily: 'SFMono-Regular, Consolas, "Liberation Mono", Menlo, Courier, monospace',
          lineNumbers: 'on',
          roundedSelection: false,
          scrollBeyondLastLine: false,
          readOnly: false,
          cursorStyle: 'line',
          folding: true,
          tabSize: 2,
          insertSpaces: true
        });

        // Register Run Command (Ctrl+Enter or Cmd+Enter)
        monacoEditorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
          drawerElement.querySelector('.drawer-actions .run-btn').click();
        });

        // Intercept and disable Ctrl+S / Cmd+S save action
        monacoEditorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
          // Do nothing, preventing browser save dialog
        });
      }

      // Detach any existing model
      monacoEditorInstance.setModel(null);

      // Share the EXACT SAME TextModel used in the inline editor
      let model = playground.monacoModel;
      if (!model) {
        model = monaco.editor.createModel(playground.textarea.value, playground.lang);
      }
      
      monacoEditorInstance.setModel(model);
      monacoEditorInstance.focus();
    }).catch(err => {
      loader.textContent = 'Failed to load VS Code Editor: ' + err.message;
      console.error(err);
    });
  }

  function closeMonacoDrawer() {
    if (drawerElement) {
      drawerElement.classList.remove('open');
      backdropElement.classList.remove('open');
    }
    if (monacoEditorInstance) {
      monacoEditorInstance.setModel(null);
    }
    currentPlayground = null;
  }

  function initPlaygrounds() {
    const codeBlocks = document.querySelectorAll('pre > code');
    codeBlocks.forEach((codeEl) => {
      const className = codeEl.className || '';
      const langAttr = codeEl.getAttribute('language') || '';
      
      const isJS = className.includes('language-javascript') || className.includes('language-js') || langAttr.includes('javascript') || langAttr.includes('js');
      const isTS = className.includes('language-typescript') || className.includes('language-ts') || langAttr.includes('typescript') || langAttr.includes('ts');
      
      if (!isJS && !isTS) return;
      if (codeEl.textContent.includes('@readonly')) return;

      setupPlayground(codeEl, isTS ? 'typescript' : 'javascript');
    });
  }

  function setupPlayground(codeEl, lang) {
    if (lang === 'typescript') {
      loadTypeScriptIfNeeded();
    }
    const preEl = codeEl.parentElement;
    if (!preEl) return;

    const originalCode = codeEl.textContent;
    
    // Parse tests
    const testRegex = /^\/\/\s*@test:\s*(.+)$/gm;
    const tests = [];
    let match;
    let cleanedCode = originalCode;
    
    while ((match = testRegex.exec(originalCode)) !== null) {
      tests.push(match[1].trim());
    }
    
    cleanedCode = cleanedCode.replace(/^\/\/\s*@test:.*$/gm, '').trim();
    cleanedCode = cleanedCode.replace(/^\/\/\s*@readonly.*$/gm, '').trim();

    // Create Playground UI
    const container = document.createElement('div');
    container.className = 'playground-container';
    
    const header = document.createElement('div');
    header.className = 'playground-header';
    
    const langBadge = document.createElement('span');
    langBadge.className = 'playground-lang';
    langBadge.textContent = lang + (tests.length > 0 ? ' (Quiz)' : '');
    
    const actions = document.createElement('div');
    actions.className = 'playground-actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'playground-btn edit-btn';
    editBtn.innerHTML = 'Open in Sidebar';
    
    const resetBtn = document.createElement('button');
    resetBtn.className = 'playground-btn reset-btn';
    resetBtn.textContent = 'Reset';
    
    const runBtn = document.createElement('button');
    runBtn.className = 'playground-btn run-btn';
    runBtn.textContent = 'Run';
    
    actions.appendChild(editBtn);
    actions.appendChild(resetBtn);
    actions.appendChild(runBtn);
    header.appendChild(langBadge);
    header.appendChild(actions);
    
    const editorWrapper = document.createElement('div');
    editorWrapper.className = 'playground-editor-wrapper';
    
    const textarea = document.createElement('textarea');
    textarea.className = 'playground-textarea';
    textarea.value = cleanedCode;
    textarea.spellcheck = false;
    
    const lineCount = cleanedCode.split('\n').length;
    textarea.style.height = (lineCount * 22 + 32) + 'px';
    
    editorWrapper.appendChild(textarea);
    
    const consoleArea = document.createElement('div');
    consoleArea.className = 'playground-console';
    consoleArea.style.display = 'none';
    
    const banner = document.createElement('div');
    banner.className = 'playground-banner';
    banner.style.display = 'none';
    
    container.appendChild(header);
    container.appendChild(editorWrapper);
    container.appendChild(banner);
    container.appendChild(consoleArea);
    
    preEl.parentNode.replaceChild(container, preEl);

    // Assemble playground instance
    const playgroundInstance = {
      lang: lang,
      cleanedOriginalCode: cleanedCode,
      tests: tests,
      textarea: textarea,
      consoleArea: consoleArea,
      banner: banner,
      editorWrapper: editorWrapper,
      monacoEditor: null,
      monacoModel: null,
      resetInline: () => {
        if (playgroundInstance.monacoEditor) {
          playgroundInstance.monacoEditor.setValue(cleanedCode);
        } else {
          textarea.value = cleanedCode;
          textarea.style.height = (lineCount * 22 + 32) + 'px';
        }
        consoleArea.style.display = 'none';
        consoleArea.innerHTML = '';
        banner.style.display = 'none';
      }
    };
    
    activePlaygrounds.push(playgroundInstance);

    // If Monaco is already loaded globally, initialize inline editor immediately
    if (isMonacoInitializedGlobal && monacoGlobalRef) {
      initInlineMonaco(playgroundInstance, monacoGlobalRef);
    }
    
    // Action events
    editBtn.addEventListener('click', () => {
      openMonacoDrawer(playgroundInstance);
    });

    runBtn.addEventListener('click', () => {
      const code = playgroundInstance.monacoModel ? playgroundInstance.monacoModel.getValue() : textarea.value;
      runCodeUnified(code, tests, lang === 'typescript', [consoleArea], [banner], playgroundInstance);
    });
    
    resetBtn.addEventListener('click', () => {
      playgroundInstance.resetInline();
    });
  }

  function runCodeUnified(userCode, tests, isTS, consoleEls, bannerEls, playground) {
    // 1. Diagnostics validation check: Block run if compiler or type errors exist
    if (playground && playground.monacoModel && typeof monaco !== 'undefined') {
      const markers = monaco.editor.getModelMarkers({ resource: playground.monacoModel.uri });
      const hasErrors = markers.some(marker => marker.severity === monaco.MarkerSeverity.Error);
      
      if (hasErrors) {
        consoleEls.forEach(el => {
          el.style.display = 'block';
          el.innerHTML = '';
          appendConsoleEntry(el, 'error', 'Uncaught SyntaxError: Cannot execute code with compiler/type errors.');
        });
        bannerEls.forEach(el => el.style.display = 'none');
        return; // Halt execution
      }
    }

    consoleEls.forEach(el => {
      el.style.display = 'block';
      el.innerHTML = '';
      appendConsoleEntry(el, 'system', 'Executing...');
    });
    bannerEls.forEach(el => el.style.display = 'none');
    
    const logs = [];
    const customConsole = {
      log: (...args) => {
        logs.push({
          type: 'log',
          text: args.map(a => {
            if (a === null) return 'null';
            if (a === undefined) return 'undefined';
            return typeof a === 'object' ? JSON.stringify(a, null, 2) : a.toString();
          }).join(' ')
        });
      },
      error: (...args) => {
        logs.push({
          type: 'error',
          text: args.map(a => typeof a === 'object' ? JSON.stringify(a) : a.toString()).join(' ')
        });
      }
    };

    function assert(condition, message) {
      if (!condition) {
        throw new Error(message || "Assertion failed");
      }
    }

    setTimeout(() => {
      try {
        let executableCode = userCode;
        if (isTS) {
          if (typeof ts === 'undefined') {
            throw new ReferenceError("ts is not defined (TypeScript compiler is loading, please wait...)");
          }
          executableCode = ts.transpile(userCode);
        }

        const runner = new Function('console', 'assert', `
          ${executableCode}
        `);
        runner(customConsole, assert);
        
        let testFailed = false;
        const testLogs = [];
        const dummyConsole = { log: () => {}, error: () => {} };
        
        if (tests.length > 0) {
          for (const testExpr of tests) {
            try {
              const testRunner = new Function('console', 'assert', `
                ${executableCode}
                return (${testExpr});
              `);
              const testResult = testRunner(dummyConsole, assert);
              if (testResult === false) {
                throw new Error("Returned false");
              }
            } catch (err) {
              testFailed = true;
              testLogs.push({ type: 'error', text: `✗ Fail: ${testExpr} (${err.message})` });
            }
          }
        }
        
        consoleEls.forEach(el => {
          el.innerHTML = '';
          if (logs.length === 0 && testLogs.length === 0) {
            appendConsoleEntry(el, 'system', '(Code executed successfully with no console output)');
          } else {
            const allLogs = logs.concat(testLogs);
            allLogs.forEach(log => {
              appendConsoleEntry(el, log.type, log.text);
            });
          }
        });
        
        if (tests.length > 0) {
          if (testFailed) {
            updateBanners(bannerEls, 'fail', 'Some tests failed. Keep trying!');
          } else {
            hideBanners(bannerEls);
          }
        }

      } catch (err) {
        consoleEls.forEach(el => {
          el.innerHTML = '';
          let prefix = 'Uncaught ';
          let errorMsg = '';
          if (err instanceof ReferenceError) {
            errorMsg = `${prefix}ReferenceError: ${err.message}`;
          } else if (err instanceof TypeError) {
            errorMsg = `${prefix}TypeError: ${err.message}`;
          } else if (err instanceof SyntaxError) {
            errorMsg = `${prefix}SyntaxError: ${err.message}`;
          } else if (err instanceof RangeError) {
            errorMsg = `${prefix}RangeError: ${err.message}`;
          } else {
            errorMsg = `${prefix}${err.name || 'Error'}: ${err.message}`;
          }
          appendConsoleEntry(el, 'error', errorMsg);
        });
        
        if (tests.length > 0) {
          hideBanners(bannerEls);
        }
      }
    }, 50);
  }

  function appendConsoleEntry(consoleEl, type, text) {
    const entry = document.createElement('div');
    const isDrawer = consoleEl.classList.contains('console-body');
    entry.className = isDrawer ? `console-entry ${type}` : `playground-console-entry ${type}`;
    entry.textContent = text;
    consoleEl.appendChild(entry);
    consoleEl.scrollTop = consoleEl.scrollHeight;
  }

  function updateBanners(bannerEls, status, message) {
    bannerEls.forEach(el => {
      el.style.display = 'flex';
      const isDrawer = el.classList.contains('drawer-banner');
      el.className = isDrawer ? `drawer-banner ${status}` : `playground-banner ${status}`;
      el.textContent = message;
    });
  }

  function hideBanners(bannerEls) {
    bannerEls.forEach(el => {
      el.style.display = 'none';
    });
  }

  loadTypeScriptIfNeeded();
  loadMonaco().then(monaco => {
    handleMonacoLoaded(monaco);
  });
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPlaygrounds);
  } else {
    initPlaygrounds();
  }
})();
