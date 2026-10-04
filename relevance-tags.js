const TOPICS = [
  { pattern: /\b(?:cats?|kittens?)\b|mèo|猫/iu, tags: { vi: ['#meo', '#thucung'], en: ['#cat', '#pets'] } },
  { pattern: /\b(?:dogs?|pupp(?:y|ies))\b|chó|狗/iu, tags: { vi: ['#cho', '#thucung'], en: ['#dog', '#pets'] } },
  { pattern: /\b(?:food|cooking|recipe)\b|món ăn|nấu ăn|ẩm thực|美食|做饭/iu, tags: { vi: ['#amthuc', '#nauan'], en: ['#food', '#cooking'] } },
  { pattern: /\b(?:travel|trip)\b|du lịch|旅行|旅游/iu, tags: { vi: ['#dulich'], en: ['#travel'] } },
  { pattern: /\b(?:nature|forest|mountain|landscape|scenery|countryside)\b|thiên nhiên|phong cảnh|rừng|núi|đồng quê|自然|森林|山景|风景|乡村/iu, tags: { vi: ['#thiennhien', '#phongcanh'], en: ['#nature', '#landscape'] } },
  { pattern: /\b(?:garden|flowers?)\b|vườn|(?<!\p{L})hoa(?!\p{L})|花园|鲜花/iu, tags: { vi: ['#vuonhoa'], en: ['#garden'] } },
  { pattern: /\b(?:ocean|sea|beach|waves)\b|bãi biển|海边|大海/iu, tags: { vi: ['#bien'], en: ['#ocean'] } },
  { pattern: /\b(?:sunset|sunrise)\b|hoàng hôn|bình minh|日落|日出/iu, tags: { vi: ['#phongcanh'], en: ['#goldenhour'] } },
  { pattern: /\b(?:rain|rainy)\b|mưa|下雨|雨天/iu, tags: { vi: ['#ngaymua'], en: ['#rainydays'] } },
  { pattern: /\b(?:music|songs?|singing|piano|guitar)\b|âm nhạc|bài hát|nghe nhạc|音乐|听歌|钢琴|吉他/iu, tags: { vi: ['#amnhac'], en: ['#music'] } },
  { pattern: /\b(?:books?|reading)\b|đọc sách|读书|阅读/iu, tags: { vi: ['#docsach'], en: ['#reading'] } },
  { pattern: /\b(?:love|heartbreak|missing you|relationship)\b|tình yêu|thất tình|nhớ em|nhớ anh|爱情|失恋|想你|思念/iu, tags: { vi: ['#tinhyeu', '#tamtrang'], en: ['#love', '#feelings'] } },
  { pattern: /\b(?:healing|peaceful|quiet|calm)\b|bình yên|chữa lành|治愈|平静/iu, tags: { vi: ['#binhyen'], en: ['#quietmoments'] } },
  { pattern: /\b(?:sad|lonely|feelings|mood)\b|cô đơn|nỗi buồn|tâm trạng|buồn|孤独|悲哀|情绪/iu, tags: { vi: ['#tamtrang'], en: ['#mood'] } },
  { pattern: /\b(?:daily life|daily moments|plog)\b|đời thường|cuộc sống hằng ngày|日常|生活碎片/iu, tags: { vi: ['#doithuong'], en: ['#dailylife'] } },
  { pattern: /\b(?:anime|animation)\b|anime|hoạt hình|动漫|蔚蓝档案/iu, tags: { vi: ['#anime'], en: ['#anime'] } }
];

export const HASHTAG_COUNT = 5;
const EXTRA_TAGS = {
  '#cat': { vi: ['#yeumeo', '#khoanhkhacthucung', '#hoiyeumeo'], en: ['#catlife', '#petmoments', '#catlovers'] },
  '#dog': { vi: ['#yeucho', '#khoanhkhacthucung', '#hoiyeucho'], en: ['#doglife', '#petmoments', '#doglovers'] },
  '#food': { vi: ['#monan', '#bepnha', '#yeubep'], en: ['#foodie', '#foodlovers', '#homecooking'] },
  '#travel': { vi: ['#khampha', '#hanhtrinh', '#diemden', '#trainghiem'], en: ['#explore', '#travelmoments', '#destinations', '#travelstories'] },
  '#nature': { vi: ['#ngamcanh', '#khoanhkhacthiennhien', '#yeuthiennhien'], en: ['#naturelovers', '#scenery', '#naturemoments'] },
  '#garden': { vi: ['#hoala', '#yeuthiennhien', '#ngamhoa', '#khoanhkhacthiennhien'], en: ['#gardenlovers', '#botanical', '#gardenmoments', '#naturelovers'] },
  '#ocean': { vi: ['#ngamcanh', '#canhbiendep', '#yeubien', '#khoanhkhacbenbien'], en: ['#oceanlovers', '#seascape', '#coastalmoments', '#oceanviews'] },
  '#goldenhour': { vi: ['#ngambautroi', '#khoanhkhacthiennhien', '#yeuthiennhien', '#ngamcanh'], en: ['#sky', '#scenery', '#naturemoments', '#skywatching'] },
  '#rainydays': { vi: ['#khoanhkhacngaymua', '#tiengmua', '#ngammua', '#muaroi'], en: ['#rain', '#rainymoments', '#rainwatching', '#rainmood'] },
  '#music': { vi: ['#nghenhac', '#yeuamnhac', '#giaidieu', '#camxucamnhac'], en: ['#musiclovers', '#listeningtomusic', '#melody', '#musicmood'] },
  '#reading': { vi: ['#yeusach', '#sachhay', '#khoanhkhacdocsach', '#thegioisach'], en: ['#booklovers', '#readingtime', '#bookish', '#readingmoments'] },
  '#love': { vi: ['#camxuc', '#chuyentinhyeu', '#loitamsu'], en: ['#lovestories', '#emotions', '#heartfelt'] },
  '#quietmoments': { vi: ['#songcham', '#khoanhkhacbinhyen', '#chamlaimotchut', '#tinhlang'], en: ['#slowliving', '#peacefulmoments', '#stillness', '#calmmoments'] },
  '#mood': { vi: ['#camxuc', '#tamsu', '#dongtamtrang', '#noilong'], en: ['#feelings', '#emotions', '#reflection', '#innerthoughts'] },
  '#dailylife': { vi: ['#khoanhkhac', '#nhatky', '#chuyenthuongngay', '#cuocsong'], en: ['#dailymoments', '#everydaystories', '#lifemoments', '#visualdiary'] },
  '#anime': { vi: ['#animeart', '#animecommunity', '#animefans', '#animeaesthetic'], en: ['#animeart', '#animecommunity', '#animefans', '#animeaesthetic'] }
};
const GENERAL_TAGS = { vi: ['#khoanhkhac', '#cauchuyen', '#chiase', '#gocnhin', '#noidung'], en: ['#moments', '#storytelling', '#sharing', '#perspective', '#creativecontent'] };
const TAG = /#[\p{L}\p{N}_]+/gu;
const uniqueTags = tags => [...new Map(tags.filter(tag => [...tag].length <= 64).map(tag => [tag.toLowerCase(), tag])).values()];

function topicTags(topic, lang) {
  const extras = EXTRA_TAGS[topic.tags.en[0]];
  const vi = [...topic.tags.vi, ...extras.vi];
  const en = [...topic.tags.en, ...extras.en];
  return lang === 'both' ? vi.flatMap((tag, index) => [tag, en[index]].filter(Boolean)) : lang === 'en' ? en : vi;
}

export function relevantHashtags(title, lang = 'vi') {
  const text = String(title || '').normalize('NFC');
  const existing = new Set((text.match(TAG) || []).map(tag => tag.toLowerCase()));
  const topics = TOPICS.filter(topic => topic.pattern.test(text) || [...topicTags(topic, 'vi'), ...topicTags(topic, 'en')].some(tag => existing.has(tag.toLowerCase()))).slice(0, 2);
  const banks = topics.map(topic => topicTags(topic, lang));
  const tags = [];
  // Mix both detected topics before filling the remaining slots.
  for (let index = 0; index < 5; index++) for (const bank of banks) if (bank[index]) tags.push(bank[index]);
  return uniqueTags([...tags, ...GENERAL_TAGS[lang === 'en' ? 'en' : 'vi']]).slice(0, HASHTAG_COUNT).join(' ');
}

export function ensureCaptionHashtags(value, lang = 'en', context = '') {
  const text = String(value || '').trim();
  const existing = uniqueTags(text.match(TAG) || []);
  const generated = relevantHashtags(`${text} ${context}`, lang).split(' ');
  const tags = uniqueTags([...existing, ...generated, ...GENERAL_TAGS[lang === 'en' ? 'en' : 'vi']]).slice(0, HASHTAG_COUNT);
  const body = text.replace(TAG, '').replace(/\n{3,}/g, '\n\n').trim();
  return [body, tags.join(' ')].filter(Boolean).join('\n\n');
}
