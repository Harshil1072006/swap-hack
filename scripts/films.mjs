import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const source = process.argv[2];
if (!source) throw new Error('Pass the path to the four-frame contact sheet.');
const scratch = mkdtempSync(join(tmpdir(), 'swap-films-'));
const output = 'public/media/swap-films';
const filmPages = 'public/films';
mkdirSync(output, { recursive: true });
mkdirSync(filmPages, { recursive: true });
const fonts = {
  en: '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  hi: '/usr/share/fonts/truetype/noto/NotoSansDevanagari-Bold.ttf',
  gu: '/usr/share/fonts/truetype/noto/NotoSansGujarati-Bold.ttf',
};
const scripts = {
  en: {
    home: 'Event home', transcript: 'Transcript', download: 'Download MP4',
    scenes: ['A grower holds a note beside fresh tomatoes.', 'Two people exchange a card across a table.', 'A student works on a laptop.', 'A phone displays a list beside the produce.'],
    'the-swap': ['How the swap works', 'A grower needs to know what buyers want.', 'We remove identifying details and swap briefs.', 'A student has seven days to build a website.', 'The grower tests it. Judges score independently.'],
    'write-a-brief': ['Write a useful problem brief', 'Choose a specific person affected by the problem.', 'Describe what goes wrong and how they cope today.', 'Name one test, such as filtering requests by crop.', 'Leave out names and contact details.'],
  },
  hi: {
    home: 'कार्यक्रम का मुख्य पृष्ठ', transcript: 'लिखित विवरण', download: 'MP4 डाउनलोड करें',
    scenes: ['टमाटरों के पास एक किसान के हाथ में पर्ची है।', 'दो लोग मेज़ पर एक कार्ड की अदला-बदली करते हैं।', 'एक विद्यार्थी लैपटॉप पर काम करता है।', 'उपज के पास फ़ोन पर एक सूची दिखती है।'],
    'the-swap': ['समस्याओं की अदला-बदली कैसे होती है', 'किसान जानना चाहते हैं कि खरीदारों को क्या चाहिए।', 'हम पहचान हटाकर समस्याएँ अदलते हैं।', 'विद्यार्थी सात दिनों में वेबसाइट बनाते हैं।', 'किसान उसे आज़माते हैं। निर्णायक अलग से अंक देते हैं।'],
    'write-a-brief': ['समस्या का उपयोगी विवरण लिखें', 'बताएँ कि किस व्यक्ति को समस्या होती है।', 'बताएँ क्या गलत होता है और अभी वे क्या करते हैं।', 'एक जाँच लिखें, जैसे फ़सल के अनुसार माँग देखें।', 'नाम और संपर्क जानकारी छोड़ दें।'],
  },
  gu: {
    home: 'કાર્યક્રમનું મુખ્ય પાનું', transcript: 'લખિત વર્ણન', download: 'MP4 ડાઉનલોડ કરો',
    scenes: ['ટામેટાં પાસે ખેડૂતના હાથમાં ચિઠ્ઠી છે.', 'બે લોકો ટેબલ પર કાર્ડની આપલે કરે છે.', 'એક વિદ્યાર્થી લેપટોપ પર કામ કરે છે.', 'ઉપજ પાસે ફોન પર યાદી દેખાય છે.'],
    'the-swap': ['સમસ્યાઓની આપલે કેવી રીતે થાય છે', 'ખેડૂતને જાણવું છે કે ખરીદદારોને શું જોઈએ છે.', 'અમે ઓળખ દૂર કરીને સમસ્યાઓની આપલે કરીએ છીએ.', 'વિદ્યાર્થી પાસે વેબસાઇટ બનાવવા સાત દિવસ છે.', 'ખેડૂત તેને અજમાવે છે. નિર્ણાયકો અલગથી ગુણ આપે છે.'],
    'write-a-brief': ['સમસ્યાનું ઉપયોગી વર્ણન લખો', 'સમસ્યાથી કોને મુશ્કેલી પડે છે તે જણાવો.', 'શું ખોટું થાય છે અને અત્યારે શું કરે છે તે જણાવો.', 'એક કસોટી લખો, જેમ કે પાક મુજબ માંગ શોધવી.', 'નામ અને સંપર્કની માહિતી કાઢી નાખો.'],
  },
};
const titles = { en: 'Swap Hack films', hi: 'Swap Hack की फ़िल्में', gu: 'Swap Hackની ફિલ્મો' };
function encode(args) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
  if (result.status) throw new Error('Film encoding failed.');
}
for (const [locale, copy] of Object.entries(scripts)) {
  let sections = '';
  for (const [name, seconds, order] of [['the-swap', 5, [0, 1, 2, 3]], ['write-a-brief', 6, [0, 2, 3, 1]]]) {
    const [title, ...lines] = copy[name];
    const base = name + '-' + locale;
    const files = [];
    for (const [index, quadrant] of order.entries()) {
      const words = join(scratch, 'caption.txt');
      writeFileSync(words, lines[index]);
      const clip = join(scratch, 'scene-' + index + '.mp4');
      files.push(clip);
      const graph = [
        `crop=trunc(iw/4)*2:trunc(ih/4)*2:${quadrant % 2 ? 'iw/2' : 0}:${quadrant > 1 ? 'ih/2' : 0}`,
        'scale=1280:720:force_original_aspect_ratio=increase', 'crop=1280:720', 'setsar=1',
        `zoompan=z='1+0.00055*on':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=${seconds * 24}:s=854x480:fps=24`,
        'drawbox=x=0:y=ih-102:w=iw:h=102:color=0x1d2821:t=fill',
        `drawtext=fontfile=${fonts[locale]}:textfile=${words}:expansion=none:fontsize=28:fontcolor=0xf7f7ef:x=34:y=h-63`,
      ].join(',');
      encode(['-i', source, '-vf', graph, '-t', String(seconds), '-c:v', 'libx264', '-preset', 'fast', '-crf', '28', '-pix_fmt', 'yuv420p', '-threads', '2', clip]);
    }
    const listing = join(scratch, 'clips.txt');
    writeFileSync(listing, files.map((file) => "file '" + file + "'").join('\n'));
    const video = output + '/' + base + '.mp4';
    encode(['-f', 'concat', '-safe', '0', '-i', listing, '-c', 'copy', '-movflags', '+faststart', video]);
    encode(['-i', video, '-frames:v', '1', '-c:v', 'libwebp', '-quality', '83', output + '/' + base + '.webp']);
    if (statSync(video).size > 560000) throw new Error(base + ' exceeds the film byte budget.');
    sections += `<section class="panel film-panel" id="${name}"><h2>${title}</h2>
      <video controls playsinline preload="none" width="854" height="480" poster="/media/swap-films/${base}.webp" aria-label="${title}">
        <source src="/media/swap-films/${base}.mp4" type="video/mp4">
      </video><p><a href="/media/swap-films/${base}.mp4" download>${copy.download}</a></p>
      <details><summary>${copy.transcript}</summary><ol class="film-transcript">${lines.map((line, i) =>
        `<li><time>${String(i * seconds).padStart(2, '0')}–${String((i + 1) * seconds).padStart(2, '0')} s</time> <p>${copy.scenes[order[i]]} ${line}</p></li>`).join('')}</ol></details></section>`;
  }
  writeFileSync(filmPages + '/' + locale + '.html', `<!doctype html>
<html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${titles[locale]}</title><link rel="stylesheet" href="/style.css"></head>
<body><main class="wrap route film-page"><nav class="film-nav" aria-label="${titles[locale]}">
<a href="/${locale}/">${copy.home}</a><a href="/films/en.html" lang="en">English</a>
<a href="/films/hi.html" lang="hi">हिंदी</a><a href="/films/gu.html" lang="gu">ગુજરાતી</a></nav>
<h1>${titles[locale]}</h1>${sections}</main></body></html>\n`);
}
