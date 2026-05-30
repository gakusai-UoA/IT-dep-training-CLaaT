/* build.js */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SLIDES_DIR = path.resolve(__dirname, '..');
const OUTPUT_DIR = __dirname;
const PLAYGROUND_JS_SRC = path.join(__dirname, 'playground.js');
const PLAYGROUND_CSS_SRC = path.join(__dirname, 'playground.css');

// Copy assets
const assetsSrcDir = path.join(SLIDES_DIR, '..', 'assets');
const assetsDestDir = path.join(OUTPUT_DIR, 'assets');

console.log(`Copying assets from ${assetsSrcDir} to ${assetsDestDir}...`);
try {
  if (!fs.existsSync(assetsDestDir)) {
    fs.mkdirSync(assetsDestDir, { recursive: true });
  }
  execSync(`cp -R "${assetsSrcDir}/" "${assetsDestDir}/"`);
} catch (err) {
  console.error('Failed to copy assets:', err.message);
}

// Create placeholder for image.png
const imagePlaceholderPath = path.join(OUTPUT_DIR, 'image.png');
if (!fs.existsSync(imagePlaceholderPath)) {
  fs.writeFileSync(imagePlaceholderPath, '');
}

// Helper to determine if a line starts a major topic (CLaaT Step)
function isMajorTopicHeading(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('## ')) return false;
  
  const title = trimmed.slice(3).trim();
  
  // If it's a hint, it's NOT a major topic heading (should be grouped under the previous topic!)
  if (/ヒント/i.test(title)) return false;
  
  // 1. Main sections (e.g. "1. Topic", "2. Topic") but NOT subsections like "1-1. Topic" or "2.3. Topic"
  if (/^\d+\.\s+/.test(title)) return true;
  
  // 2. Quizzes, Exercises, Explanations, and Columns
  if (/^(?:Q\d+|練習問題|【解説】|【Column】|解説)/i.test(title)) return true;
  
  // 3. Common metadata/structural pages
  if (/^(?:目次|自己紹介|まとめ|Next Steps|Overview)/i.test(title)) return true;
  if (/目次|まとめ$/i.test(title)) return true;
  
  return false;
}

// Helper to format CLaaT step titles nicely (removing double numbering)
function formatStepTitle(title, lastExerciseTitle) {
  let clean = title.trim();
  
  let isExplanation = false;
  let isHint = false;
  let isColumn = false;
  let isExercise = false;
  
  if (/ヒント/i.test(clean)) {
    isHint = true;
  } else if (/解説|【解説】/i.test(clean)) {
    isExplanation = true;
  } else if (/コラム|【Column】/i.test(clean)) {
    isColumn = true;
  } else if (/練習問題|Q\d+/i.test(clean)) {
    isExercise = true;
  }
  
  // Strip prefixes
  clean = clean.replace(/^\d+(?:-\d+)?\.\s*/, '');
  clean = clean.replace(/^Q\d+(?:\.\s*|\s*)/i, '');
  clean = clean.replace(/^練習問題:\s*/, '');
  clean = clean.replace(/^【解説】\s*/, '');
  clean = clean.replace(/^【Column】\s*/, '');
  clean = clean.replace(/^解説\s*/, '');
  clean = clean.replace(/[*_`]/g, '').trim();
  
  // If generic title like "解説" or "ヒント", use the context from the last exercise
  if ((clean === '' || clean === '解説' || clean === 'ヒント') && lastExerciseTitle) {
    clean = lastExerciseTitle;
  }
  
  if (isHint) {
    clean += ' (ヒント)';
  } else if (isExplanation) {
    clean += ' (解説)';
  } else if (isColumn) {
    clean += ' (コラム)';
  } else if (isExercise) {
    clean += ' (練習問題)';
  }
  
  return clean || 'Overview';
}

// Find all Part-*.md files
const slideFiles = fs.readdirSync(SLIDES_DIR)
  .filter(file => file.startsWith('Part-') && file.endsWith('.md'))
  .map(file => path.join(SLIDES_DIR, file));

console.log(`Found slide files: ${slideFiles.map(f => path.basename(f)).join(', ')}`);

slideFiles.forEach(filePath => {
  const fileName = path.basename(filePath);
  const partNum = fileName.match(/Part-(\d+)/)[1];
  const codelabId = `part-${partNum}`;
  
  console.log(`Processing ${fileName} (ID: ${codelabId})...`);
  
  let content = fs.readFileSync(filePath, 'utf8');
  content = content.replace(/\.\.\/assets\//g, 'assets/');
  content = content.replace(/\.\.\/image\.png/g, 'image.png');
  
  const normalizedContent = content.replace(/\r\n/g, '\n');
  const rawSlides = normalizedContent.split(/\n---\n/);
  
  let slides = [];
  if (normalizedContent.startsWith('---')) {
    slides = rawSlides.slice(2);
  } else {
    slides = rawSlides;
  }
  
  // Determine Main Title
  let title = `Part ${partNum} Training`;
  for (const slide of slides) {
    const titleMatch = slide.match(/^#\s+(.+)$/m);
    if (titleMatch) {
      title = titleMatch[1].trim();
      break;
    }
  }
  
  // Generate CLaaT Header
  let claatContent = `author: IT Department
summary: ${title}
id: ${codelabId}
categories: Web Development, Training
environments: Web
status: Published
feedback link: https://github.com/gakusai-UoA/sosho-2026

# ${title}

`;

  let currentStepTitle = 'Overview';
  let currentStepContent = [];
  let lastExerciseTitle = '';
  
  // Process and group slides by topic
  slides.forEach((slide) => {
    let cleanSlide = slide.trim();
    if (!cleanSlide) return;
    
    // Check if the slide starts with a major heading
    const lines = cleanSlide.split('\n');
    const firstLine = lines[0] || '';
    
    if (isMajorTopicHeading(firstLine)) {
      // Flush previous step if it has content
      if (currentStepContent.length > 0) {
        claatContent += `## ${currentStepTitle}\nDuration: 2\n\n${currentStepContent.join('\n\n***\n\n')}\n\n`;
      }
      
      const rawTitle = firstLine.replace('## ', '').trim();
      
      // Update lastExerciseTitle if this heading represents an exercise
      if (rawTitle.includes('練習問題') || /^Q\d+/i.test(rawTitle)) {
        lastExerciseTitle = rawTitle
          .replace(/^Q\d+(?:\.\s*|\s*)/i, '')
          .replace(/^練習問題:\s*/, '')
          .replace(/[*_`]/g, '')
          .trim();
      }
      
      // Format new step title
      currentStepTitle = formatStepTitle(rawTitle, lastExerciseTitle);
      
      // Keep only content below the header
      const restContent = lines.slice(1).join('\n').trim();
      
      // Demote any remaining # or ## in the slide to ###
      const demotedContent = restContent.split('\n').map(line => {
        if (line.startsWith('## ')) return '### ' + line.slice(3);
        if (line.startsWith('# ')) return '### ' + line.slice(2);
        return line;
      }).join('\n').trim();
      
      currentStepContent = demotedContent ? [demotedContent] : [];
    } else {
      // Group slide under the current step
      // Demote all headings in this slide to preserve step structure
      const demotedSlide = cleanSlide.split('\n').map(line => {
        if (line.startsWith('## ')) return '### ' + line.slice(3);
        if (line.startsWith('# ')) return '### ' + line.slice(2);
        return line;
      }).join('\n').trim();
      
      if (demotedSlide) {
        currentStepContent.push(demotedSlide);
      }
    }
  });
  
  // Flush the final step
  if (currentStepContent.length > 0) {
    claatContent += `## ${currentStepTitle}\nDuration: 2\n\n${currentStepContent.join('\n\n***\n\n')}\n\n`;
  }

  const tempMDPath = path.join(OUTPUT_DIR, `${codelabId}.md`);
  fs.writeFileSync(tempMDPath, claatContent, 'utf8');
  console.log(`Generated CLaaT Markdown: ${tempMDPath}`);
  
  try {
    console.log(`Exporting ${codelabId} with claat...`);
    execSync(`claat export ${codelabId}.md`, { cwd: OUTPUT_DIR, stdio: 'inherit' });
    
    fs.unlinkSync(tempMDPath);
    
    const generatedHtmlDir = path.join(OUTPUT_DIR, codelabId);
    const htmlPath = path.join(generatedHtmlDir, 'index.html');
    
    if (fs.existsSync(htmlPath)) {
      console.log(`Injecting playground assets into ${htmlPath}...`);
      let html = fs.readFileSync(htmlPath, 'utf8');
      
      fs.copyFileSync(PLAYGROUND_JS_SRC, path.join(generatedHtmlDir, 'playground.js'));
      fs.copyFileSync(PLAYGROUND_CSS_SRC, path.join(generatedHtmlDir, 'playground.css'));
      
      const cssInject = '\n  <link rel="stylesheet" href="playground.css">';
      html = html.replace('</head>', `${cssInject}\n</head>`);
      
      const jsInject = '\n  <script src="playground.js"></script>';
      html = html.replace('</body>', `${jsInject}\n</body>`);
      
      fs.writeFileSync(htmlPath, html, 'utf8');
      console.log(`Successfully compiled and injected ${codelabId}!`);
    } else {
      console.error(`Error: Generated HTML file not found at ${htmlPath}`);
    }
  } catch (err) {
    console.error(`Failed to export ${codelabId}:`, err);
  }
});

console.log('All slides converted successfully.');
