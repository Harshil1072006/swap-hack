import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { supportedLocales, localized, t } from '../public/locale.js';

const template = await readFile('public/index.html', 'utf8');
const descriptions = {
  en: 'Swap Hack is a free seven-day build sprint for students in and around Kheda, Gujarat. Bring a real problem and build a solution for a stranger.',
  hi: 'Swap Hack खेड़ा, गुजरात का मुफ़्त हैकाथॉन है। एक असली समस्या बताएँ और सात दिनों में किसी और की समस्या का समाधान बनाएँ।',
  gu: 'Swap Hack ખેડા, ગુજરાતનો મફત હેકાથોન છે. સાચી સમસ્યા જણાવો અને સાત દિવસમાં કોઈ બીજાની સમસ્યાનો ઉકેલ બનાવો.',
};
for (const lang of supportedLocales) {
  const markup = template.split(/(<[^>]+>)/g).map((piece) => {
    if (piece.startsWith('<')) return piece;
    const source = piece.trim().replace(/\s+/g, ' ');
    const translated = t(source, {}, lang);
    return translated === source ? piece : piece.replace(/\S[\s\S]*\S|\S/, translated);
  }).join('')
    .replace('<html lang="en">', '<html lang="' + lang + '">')
    .replace(descriptions.en, descriptions[lang])
    .replace('Swap Hack | A hackathon for real problems', 'Swap Hack | ' + t('A community hackathon in Kheda, Gujarat', {}, lang))
    .replace(/(<a\b[^>]*\bhref=")(\/[^"]*)(")/g, (_, prefix, path, suffix) => prefix + localized(path, lang) + suffix)
    .replace('/films/en.html#the-swap', '/films/' + lang + '.html#the-swap')
    .replace('</head>', `  <link rel="canonical" href="/${lang}/">
    ${supportedLocales.map((alternate) => `<link rel="alternate" hreflang="${alternate}" href="/${alternate}/">`).join('\n    ')}
  </head>`);
  await mkdir('public/' + lang, { recursive: true });
  await writeFile('public/' + lang + '/index.html', markup);
}
