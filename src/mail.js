export const localeOf = (locale) => ['hi', 'gu'].includes(locale) ? locale : 'en';
export const acknowledgement = {
  en: [
    'My information is accurate and I am 18 or older.',
    'I keep ownership of my problem idea and allow the organizers to share an anonymous brief with builders. A submission gives me no promise of payment or a solution.',
    'The organizers may keep an anonymous copy in the problem bank for future events.',
    'The organizers may group duplicate problems and split a prize among the verified authors of a winning group.',
    'If my problem is selected, I will test the solution and give feedback on days 17–18.',
    'I accept the event terms and privacy notice.',
  ],
  hi: [
    'मेरी जानकारी सही है और मेरी उम्र 18 वर्ष या उससे अधिक है।',
    'समस्या के विचार पर मेरा स्वामित्व रहेगा। आयोजक मेरी पहचान हटाकर इसे समाधान बनाने वालों से साझा कर सकते हैं। समस्या भेजने पर भुगतान या समाधान का वादा नहीं है।',
    'आयोजक भविष्य के कार्यक्रमों के लिए समस्या की गुमनाम प्रति रख सकते हैं।',
    'आयोजक एक जैसी समस्याओं को एक साथ रख सकते हैं और विजेता समूह के सत्यापित लेखकों में पुरस्कार बाँट सकते हैं।',
    'मेरी समस्या चुनी गई तो मैं 17वें और 18वें दिन समाधान आज़माकर प्रतिक्रिया दूँगा या दूँगी।',
    'मैं कार्यक्रम की शर्तें और गोपनीयता सूचना स्वीकार करता या करती हूँ।',
  ],
  gu: [
    'મારી માહિતી સાચી છે અને મારી ઉંમર ઓછામાં ઓછી 18 વર્ષ છે.',
    'મારા વિચારની માલિકી મારી રહેશે. આયોજકો ઓળખ દૂર કરીને સમસ્યા ઉકેલ બનાવનાર સાથે વહેંચી શકે છે. સમસ્યા મોકલવાથી ચુકવણી કે ઉકેલનું વચન મળતું નથી.',
    'આયોજકો ભવિષ્યના કાર્યક્રમો માટે સમસ્યાની અનામી નકલ રાખી શકે છે.',
    'આયોજકો સમાન સમસ્યાઓને એક જૂથમાં મૂકી શકે છે અને વિજેતા જૂથના ચકાસાયેલા લેખકો વચ્ચે ઇનામ વહેંચી શકે છે.',
    'મારી સમસ્યા પસંદ થાય તો હું દિવસ 17 અને 18 દરમિયાન ઉકેલ અજમાવીને પ્રતિભાવ આપીશ.',
    'હું કાર્યક્રમની શરતો અને ગોપનીયતા સૂચના સ્વીકારું છું.',
  ],
};
const messages = {
  en: {
    codeSubject: 'Your Swap Hack sign-in code', code: (code) => `Your Swap Hack code is ${code}. It expires in ten minutes and can be used once. If you did not request it, you can ignore this email.`,
    receiptSubject: 'Swap Hack received your problem', reference: (id) => `Your reference is ${id}. Keep this email for your records.`,
    terms: 'Terms accepted', privacy: 'Privacy notice', invite: 'You have a Swap Hack team invitation',
    invitation: 'Sign in to the Swap Hack workspace with this email to review your invitation. It expires after 72 hours.',
  },
  hi: {
    codeSubject: 'आपका Swap Hack साइन-इन कोड', code: (code) => `आपका Swap Hack कोड ${code} है। इसे अगले दस मिनट में एक बार इस्तेमाल करें। आपने कोड नहीं माँगा है तो इस ईमेल को अनदेखा करें।`,
    receiptSubject: 'Swap Hack को आपकी समस्या मिल गई', reference: (id) => `आपकी संदर्भ संख्या ${id} है। इस ईमेल को संभालकर रखें।`,
    terms: 'स्वीकृत शर्तें', privacy: 'गोपनीयता सूचना', invite: 'आपको Swap Hack टीम का आमंत्रण मिला है',
    invitation: 'आमंत्रण देखने के लिए इस ईमेल से Swap Hack कार्यक्षेत्र में साइन इन करें। आमंत्रण 72 घंटे तक मान्य है।',
  },
  gu: {
    codeSubject: 'તમારો Swap Hack સાઇન-ઇન કોડ', code: (code) => `તમારો Swap Hack કોડ ${code} છે. દસ મિનિટમાં એક વાર ઉપયોગ કરો. તમે કોડ ન માંગ્યો હોય તો આ ઇમેઇલ અવગણો.`,
    receiptSubject: 'Swap Hackને તમારી સમસ્યા મળી ગઈ', reference: (id) => `તમારો સંદર્ભ ક્રમાંક ${id} છે. આ ઇમેઇલ સાચવી રાખો.`,
    terms: 'સ્વીકારેલી શરતો', privacy: 'ગોપનીયતા સૂચના', invite: 'તમને Swap Hack ટીમનું આમંત્રણ મળ્યું છે',
    invitation: 'આમંત્રણ જોવા આ ઇમેઇલથી Swap Hack કાર્યક્ષેત્રમાં સાઇન ઇન કરો. આમંત્રણ 72 કલાકમાં સમાપ્ત થશે.',
  },
};
export function codeMail(locale, code) {
  const copy = messages[localeOf(locale)];
  return { subject: copy.codeSubject, text: copy.code(code) };
}
export function registrationMail(email, result, event, origin) {
  const problem = event.problems.find((entry) => entry.id === result?.id);
  const person = event.people.find((entry) => entry.id === problem?.owner);
  if (!person) return [];
  const policy = event.policies.find((entry) => entry.id === problem.consent?.policyId);
  const locale = localeOf(policy?.locale);
  const copy = messages[locale];
  const messagesToSend = [{
    id: result.id + '-receipt', email, subject: copy.receiptSubject,
    text: [copy.reference(result.id), ...acknowledgement[locale], copy.terms, policy?.terms,
      copy.privacy, policy?.privacy, event.settings.contact].filter(Boolean).join('\n\n'),
  }];
  if (person.teammateEmail && person.invitation?.state === 'pending') messagesToSend.push({
    id: person.id + '-invite', email: person.teammateEmail, subject: copy.invite,
    text: copy.invitation + '\n\n' + origin + '/' + locale + '/workspace',
  });
  return messagesToSend;
}
export async function sendMail(env, email, message, id) {
  const headers = { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' };
  if (id) headers['Idempotency-Key'] = 'swap-hack/' + id;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers, signal: AbortSignal.timeout(8000),
    body: JSON.stringify({ from: env.MAIL_FROM, to: [email], ...message }),
  });
  if (!response.ok) throw Object.assign(new Error('Mail provider returned HTTP ' + response.status), {
    permanent: response.status >= 400 && response.status < 500 && ![408, 409, 429].includes(response.status),
  });
}
export async function deliverOutbox(env) {
  const db = env.DB;
  const timestamp = Date.now();
  const { results } = await db.prepare(`UPDATE outbox SET attempts=attempts+1,next_attempt=? WHERE id IN
    (SELECT id FROM outbox WHERE state='queued' AND next_attempt<=? ORDER BY next_attempt LIMIT 8)
    RETURNING id,recipient,subject,body,attempts`).bind(timestamp + 60000, timestamp).all();
  await Promise.all(results.map(async ({ id, recipient, subject, body, attempts }) => {
    try {
      await sendMail(env, recipient, { subject, text: body }, id);
      await db.prepare("UPDATE outbox SET state='sent',recipient='',body='' WHERE id=? AND attempts=?").bind(id, attempts).run();
    } catch (error) {
      const exhausted = error.permanent || attempts >= 7;
      const next = Date.now() + Math.min(720, 2 ** attempts) * 60000;
      await db.prepare('UPDATE outbox SET state=?,next_attempt=? WHERE id=? AND attempts=?')
        .bind(exhausted ? 'failed' : 'queued', next, id, attempts).run();
    }
  }));
}
