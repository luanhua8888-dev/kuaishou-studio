// Module tự động tạo câu chữ (story scenes) cho video slideshow TikTok theo đúng bối cảnh từng bộ ảnh

const TOPIC_PRESETS = {
  sunset: [
    [
      'Mặt trời buông xuống, khép lại một ngày dài bận rộn.',
      'Ánh hoàng hôn dịu dàng nhuộm vàng cả góc trời…',
      'Bao nhiêu mỏi mệt, xin gửi lại cho gió chiều.',
      'Ngày mai thức giấc, mọi thứ sẽ lại bắt đầu thật đẹp.'
    ],
    [
      'Có những buổi chiều chỉ muốn ngắm bầu trời thật lâu.',
      'Khi ráng chiều rực rỡ dần chuyển sang sắc tím biếc…',
      'Nhận ra bình yên đôi khi chỉ giản dị thế này thôi.',
      'Mong lòng bạn luôn giữ được sự nhẹ nhõm và an yên.'
    ],
    [
      'Hoàng hôn là minh chứng rằng kết thúc cũng có thể rất đẹp.',
      'Thả trôi những lắng lo theo ánh chiều tà muộn…',
      'Một ngày nữa đã qua, bạn đã làm rất tốt rồi.',
      'Chúc bạn một buổi tối thật dịu dàng và ấm áp.'
    ]
  ],
  rain: [
    [
      'Có những ngày, tiếng mưa rơi như một khúc nhạc êm đềm.',
      'Ngồi bên khung cửa sổ, nhìn phố xá ướt đẫm…',
      'Tâm hồn bỗng chốc lắng lại sau bao bộn bề.',
      'Mưa rồi sẽ tạnh, và cầu vồng sẽ lại xuất hiện.'
    ],
    [
      'Mưa cuốn trôi đi những bụi bặm của phố thị.',
      'Một tách trà ấm và một khoảng lặng cho riêng mình…',
      'Thả lỏng tâm trí và tận hưởng sự dịu mát này.',
      'Chúc bạn một ngày mưa thật bình yên.'
    ],
    [
      'Lắng nghe từng giọt mưa rơi tí tách ngoài hiên.',
      'Mọi ồn ào ngoài kia như tạm dừng lại…',
      'Tự thưởng cho mình một chút thảnh thơi lúc này.',
      'Mong tâm hồn bạn luôn được dịu mát như cơn mưa.'
    ]
  ],
  ocean: [
    [
      'Tiếng sóng vỗ bờ xoa dịu đi những âu lo thường nhật.',
      'Đứng trước biển rộng, thấy lòng mình nhẹ tênh…',
      'Gió biển mang theo vị tự do của đất trời.',
      'Mỗi đợt sóng qua đi, cuốn theo hết những muộn phiền.'
    ],
    [
      'Biển xanh bao la luôn bao dung và tĩnh lặng.',
      'Dạo bước trên bờ cát mịn, nghe biển thì thầm…',
      'Đôi khi chỉ cần một chuyến đi để tìm lại chính mình.',
      'Mong lòng bạn luôn bao la và êm dịu như biển cả.'
    ],
    [
      'Đại dương rộng lớn và những con sóng không ngừng vỗ.',
      'Nhìn về phía chân trời xa xăm không điểm dừng…',
      'Cảm nhận sự tự do ngập tràn trong từng hơi thở.',
      'Hãy để biển ôm lấy những muộn phiền của bạn.'
    ]
  ],
  cat: [
    [
      'Những sinh vật nhỏ bé mang lại sự chữa lành diệu kỳ.',
      'Nhìn dáng vẻ cuộn tròn ngủ say sưa này…',
      'Bao nhiêu mệt mỏi của ngày dài bỗng chốc tan biến.',
      'Hôm nay, bạn đã ôm một chút đáng yêu chưa?'
    ],
    [
      'Một chiếc ôm ấm áp từ cục bông nhỏ.',
      'Thế giới của các bé mèo thật giản đơn và bình yên…',
      'Chỉ cần bên nhau, ngày nào cũng là ngày ấm áp.',
      'Chúc bạn luôn có những niềm vui ngọt ngào như thế này.'
    ],
    [
      'Đôi mắt tròn xoe nhìn ngắm cả thế giới.',
      'Mỗi cử chỉ nhỏ cũng đủ làm trái tim tan chảy…',
      'Hạnh phúc đôi khi chỉ là tiếng gừ gừ êm ái.',
      'Gửi chút đáng yêu này đến ngày của bạn.'
    ]
  ],
  dog: [
    [
      'Ánh mắt trong veo và sự trung thành thuần khiết nhất.',
      'Mỗi lần trở về, luôn có một cái đuôi vẫy mừng đón ta…',
      'Hạnh phúc đôi khi chỉ là sự đón chờ giản dị ấy.',
      'Cảm ơn vì đã luôn là người bạn tốt nhất của mình.'
    ],
    [
      'Nụ cười rạng rỡ và nguồn năng lượng vô tận.',
      'Cùng nhau chạy nhảy dưới ánh nắng chan hòa…',
      'Tình yêu thương không cần nói thành lời.',
      'Mong bạn luôn có một người bạn đồng hành trung thành.'
    ]
  ],
  food: [
    [
      'Mùi thơm từ gian bếp luôn là điều xoa dịu nhất.',
      'Tự tay nấu một bữa ăn ngon sau ngày làm việc vất vả…',
      'Chăm chút cho bản thân từ những điều giản dị.',
      'Nhớ ăn uống thật đầy đủ và ngon miệng nhé!'
    ],
    [
      'Hương vị của sự ấm áp và sum vầy gia đình.',
      'Những món ăn ngon luôn mang lại niềm vui bất tận…',
      'Yêu cuộc sống bắt đầu từ việc yêu từng bữa ăn.',
      'Chúc bạn một bữa ăn thật ấm bụng và vui vẻ.'
    ]
  ],
  garden: [
    [
      'Mỗi bông hoa đều có thời điểm nở rộ của riêng mình.',
      'Hương sắc dịu dàng làm bừng sáng cả không gian…',
      'Bạn cũng vậy, không cần vội vã, chỉ cần luôn rạng rỡ.',
      'Chúc bạn một ngày ngập tràn sắc hoa và sự dịu dàng.'
    ],
    [
      'Dừng lại một chút để ngắm nhìn vẻ đẹp tự nhiên này.',
      'Những cánh hoa đón nắng mai thật mong manh mà kiên cường…',
      'Cuộc sống luôn có những điều tươi đẹp đợi bạn khám phá.',
      'Mong bạn luôn nở nụ cười rạng rỡ như những đóa hoa.'
    ]
  ],
  night: [
    [
      'Thành phố lên đèn, mang theo những nhịp thở trầm lắng.',
      'Mỗi ánh đèn là một câu chuyện riêng của cuộc đời…',
      'Dành cho bản thân một khoảng lặng giữa phố thị nhộn nhịp.',
      'Chúc bạn buông bỏ hết ưu phiền và ngủ thật ngon đêm nay.'
    ],
    [
      'Đêm muộn là lúc thế giới trở nên yên ắng nhất.',
      'Gửi lại sau lưng những tất bật của ngày hôm nay…',
      'Vỗ về tâm hồn và nghỉ ngơi thật trọn vẹn nhé.',
      'Ngủ ngon nhé, ngày mai sẽ là một ngày tuyệt vời.'
    ]
  ],
  love: [
    [
      'Có những người, chỉ cần nhớ đến là lòng thấy ấm áp.',
      'Khoảnh khắc bên cạnh người thương luôn trôi qua thật nhanh…',
      'Mong cho sự chân thành này luôn được trân trọng.',
      'Gửi chút dịu dàng này đến người bạn đang nhớ tới.'
    ],
    [
      'Điều đẹp đẽ nhất là tìm được một người hiểu lòng mình.',
      'Cùng nhau đi qua những ngày bình yên và cả giông bão…',
      'Hạnh phúc là khi tay trong tay bước về phía trước.',
      'Chúc cho tình yêu của bạn luôn ngọt ngào và bền lâu.'
    ]
  ],
  winter: [
    [
      'Tuyết trắng phủ kín, biến thế giới thành cổ tích.',
      'Không khí se lạnh nhưng trong lòng lại thấy thật bình yên…',
      'Mùa đông lạnh giá làm ta thêm trân quý những hơi ấm giản đơn.',
      'Giữ ấm cơ thể và tận hưởng vẻ đẹp tinh khôi này nhé.'
    ],
    [
      'Bước đi trên nền tuyết trắng tinh khôi và tĩnh lặng.',
      'Mọi âm thanh như chìm vào giấc ngủ đông…',
      'Một tách ca cao ấm giữa tiết trời se lạnh.',
      'Chúc bạn một mùa đông thật an lành và ấm áp.'
    ]
  ],
  autumn: [
    [
      'Mùa thu mang theo làn gió heo may nhè nhẹ.',
      'Những chiếc lá vàng khẽ rơi trên con đường quen thuộc…',
      'Mỗi mùa qua đi đều để lại những kỷ niệm dịu dàng.',
      'Chúc bạn một mùa thu ngọt ngào và an yên.'
    ],
    [
      'Sắc vàng của mùa thu làm dịu mát cả tâm hồn.',
      'Tiết trời thu se lạnh cho ta thêm yêu những chiếc ôm…',
      'Chậm lại một chút để cảm nhận hơi thở của thời gian.',
      'Mong mùa thu này mang đến cho bạn nhiều điều tốt lành.'
    ]
  ],
  nature: [
    [
      'Hít một hơi thật sâu không khí trong lành của núi rừng.',
      'Cây cối và đất trời luôn biết cách chữa lành mọi tổn thương…',
      'Rời xa ồn ào khói bụi, tìm lại sự an nhiên nguyên bản.',
      'Hãy để thiên nhiên vỗ về tâm hồn bạn hôm nay.'
    ],
    [
      'Màu xanh ngút ngàn mang lại nguồn năng lượng tươi mới.',
      'Lắng nghe tiếng gió reo qua từng tán cây kẽ lá…',
      'Cuộc sống vốn dĩ giản dị và tươi đẹp như thế này.',
      'Chúc bạn luôn có những phút giây nhẹ nhõm như chốn này.'
    ],
    [
      'Đứng giữa thiên nhiên bao la, thấy mình thật nhỏ bé.',
      'Mọi áp lực thường ngày bỗng chốc hóa thành mây bay…',
      'Trở về với đất trời để nạp lại nguồn năng lượng tích cực.',
      'Mong bạn luôn tìm thấy chốn bình yên cho riêng mình.'
    ]
  ],
  travel: [
    [
      'Mỗi vùng đất mới mở ra một góc nhìn mới về cuộc sống.',
      'Bước chân đi để thấy thế giới này bao la và kỳ diệu…',
      'Hành trình ý nghĩa nhất là hành trình tìm thấy chính mình.',
      'Mong đôi chân bạn luôn vững vàng trên mọi nẻo đường.'
    ],
    [
      'Tuổi trẻ là những chuyến đi không cần hẹn trước.',
      'Gom nhặt từng khoảnh khắc đẹp vào hành trang cuộc đời…',
      'Mỗi điểm dừng chân đều để lại một bài học quý giá.',
      'Chúc bạn có thêm thật nhiều chuyến đi đáng nhớ.'
    ]
  ],
  reading: [
    [
      'Lật từng trang sách, như bước vào một thế giới diệu kỳ.',
      'Tìm thấy sự bình yên giữa những con chữ mộc mạc…',
      'Mỗi câu văn là một lời thì thầm của tri thức.',
      'Khoảnh khắc tĩnh lặng quý giá sau ngày dài bận rộn.'
    ]
  ],
  music: [
    [
      'Khi lời nói bất lực, âm nhạc sẽ cất tiếng.',
      'Giai điệu quen thuộc làm sống dậy những ký ức ngọt ngào…',
      'Thả hồn vào từng nốt nhạc êm đềm xoa dịu lòng người.',
      'Bài hát nào đang đồng hành cùng bạn lúc này?'
    ]
  ],
  peaceful: [
    [
      'Dành tặng bản thân một khoảng thời gian để thở chậm lại.',
      'Không cần phải vội vã, mọi thứ đều đang diễn ra đúng lúc…',
      'Trân trọng từng khoảnh khắc giản đơn của hiện tại.',
      'Mong bạn luôn tìm thấy bình yên trong chính tâm hồn mình.'
    ],
    [
      'Cuộc sống dịu dàng hơn khi ta biết hài lòng với những điều nhỏ bé.',
      'Một góc nhỏ thân quen, một chút ánh nắng ấm áp…',
      'Học cách yêu thương và vỗ về chính bản thân mỗi ngày.',
      'Chúc bạn một ngày trôi qua thật nhẹ nhàng và vui vẻ.'
    ],
    [
      'Bình yên là khi tâm mình tĩnh lặng trước những sóng gió.',
      'Cho phép bản thân được nghỉ ngơi một chút…',
      'Hít thở thật sâu và mỉm cười với hiện tại.',
      'Mong mỗi ngày thức dậy đều là một ngày an lành với bạn.'
    ]
  ]
};

const TOPIC_MATCHERS = [
  { topic: 'sunset', pattern: /hoàng hôn|bình minh|mặt trời|ráng chiều|chiều tà|日落|日出|晚霞|夕阳|sunset|sunrise|goldenhour|dusk/iu },
  { topic: 'rain', pattern: /(?<!\p{L})mưa(?!\p{L})|ngày mưa|mưa rơi|tiếng mưa|下雨|雨天|(?<!\p{L})雨(?!\p{L})|\b(?:rain|rainy)\b/iu },
  { topic: 'ocean', pattern: /(?<!\p{L})biển(?!\p{L})|bãi biển|sóng biển|đại dương|bờ biển|大海|海边|海浪|\b(?:ocean|sea|beach|waves)\b/iu },
  { topic: 'cat', pattern: /(?<!\p{L})mèo(?!\p{L})|mèo con|hoàng thượng|猫|小猫|喵|\b(?:cats?|kittens?)\b/iu },
  { topic: 'dog', pattern: /(?<!\p{L})(?:chó|cún|cún con|cẩu)(?!\p{L})|狗|小狗|\b(?:dogs?|pupp(?:y|ies))\b/iu },
  { topic: 'food', pattern: /món ăn|nấu ăn|ẩm thực|gian bếp|bếp nhà|bữa cơm|ăn uống|ngon miệng|美食|做饭|厨房|\b(?:food|cooking|kitchen|recipe)\b/iu },
  { topic: 'garden', pattern: /(?<!\p{L})hoa(?!\p{L})|vườn hoa|bông hoa|cánh hoa|hoa lá|花园|鲜花|花海|\b(?:flowers?|gardens?|blossom)\b/iu },
  { topic: 'winter', pattern: /tuyết|mùa đông|giá lạnh|tuyết rơi|下雪|雪景|冬天|\b(?:snow|winter)\b/iu },
  { topic: 'autumn', pattern: /mùa thu|lá vàng|lá phong|thu sang|heo may|秋天|秋景|落叶|\b(?:autumn|fall)\b/iu },
  { topic: 'night', pattern: /(?<!\p{L})đêm(?!\p{L})|buổi tối|màn đêm|thành phố|lên đèn|phố thị|đèn đường|夜晚|夜景|晚安|城市|\b(?:night|city|evening)\b/iu },
  { topic: 'love', pattern: /tình yêu|nhớ em|nhớ anh|người yêu|lãng mạn|hẹn hò|người thương|爱情|喜欢你|想你|思念|\b(?:love|romantic)\b/iu },
  { topic: 'reading', pattern: /(?<!\p{L})sách(?!\p{L})|đọc sách|trang sách|nhà sách|读书|阅读|\b(?:books?|reading)\b/iu },
  { topic: 'music', pattern: /(?<!\p{L})nhạc(?!\p{L})|âm nhạc|bài hát|nghe nhạc|giai điệu|音乐|听歌|\b(?:music|songs?|melody)\b/iu },
  { topic: 'travel', pattern: /du lịch|chuyến đi|hành trình|khám phá|xách balo|旅行|旅游|出发|\b(?:travel|trips?|explore|journey)\b/iu },
  { topic: 'nature', pattern: /thiên nhiên|phong cảnh|cảnh đẹp|núi rừng|đồng quê|rừng|thung lũng|xanh ngát|自然|森林|山|乡村|风景|\b(?:nature|forest|mountain|scenery|landscape)\b/iu }
];

function stringHash(str) {
  let hash = 0;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash) + s.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function detectStoryTopic(text) {
  const norm = String(text || '').normalize('NFC').toLowerCase();
  for (const { topic, pattern } of TOPIC_MATCHERS) {
    if (pattern.test(norm)) return topic;
  }
  return 'peaceful';
}

function cleanSentence(str) {
  return String(str || '')
    .normalize('NFC')
    .replace(/^["'“‘\s\-—]+|["'”’\s\-—]+$/g, '')
    .replace(/#[\p{L}\p{N}_]+/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Tách một câu quote dài thành các vế tự nhiên (dựa trên dấu câu và liên từ)
 */
export function splitQuoteToBeats(quote, maxBeats = 4) {
  const clean = cleanSentence(quote);
  if (!clean) return [];

  // Tách theo dấu câu ngắt vế
  const rawParts = clean
    .split(/[,.;!?~—–\n|，。！？、…]+/)
    .map(p => cleanSentence(p))
    .filter(p => p.length >= 4);

  if (rawParts.length >= 2) {
    // Nếu có từ 2 vế trở lên, chọn tối đa maxBeats vế hợp lý
    const beats = [];
    for (let i = 0; i < rawParts.length && beats.length < maxBeats; i++) {
      let part = rawParts[i];
      // Viết hoa chữ cái đầu
      part = part.charAt(0).toUpperCase() + part.slice(1);
      // Thêm dấu ba chấm nếu là vế lửng và chưa có dấu kết thúc
      if (i < rawParts.length - 1 && !/[.!?…]$/.test(part)) {
        part += '…';
      } else if (!/[.!?…]$/.test(part)) {
        part += '.';
      }
      beats.push(part);
    }
    return beats;
  }

  // Nếu câu đơn không có dấu ngắt nhưng dài (> 45 ký tự hoặc > 8 từ), thử tách theo liên từ
  const words = clean.split(/\s+/);
  if (words.length >= 8 && words.length <= 25) {
    const splitWords = ['mà', 'để', 'nhưng', 'khi', 'thì', 'và', 'dù', 'cho'];
    let bestSplitIndex = -1;
    let minDiff = Infinity;
    const mid = Math.floor(words.length / 2);

    for (let i = 3; i < words.length - 3; i++) {
      if (splitWords.includes(words[i].toLowerCase())) {
        const diff = Math.abs(i - mid);
        if (diff < minDiff) {
          minDiff = diff;
          bestSplitIndex = i;
        }
      }
    }

    if (bestSplitIndex !== -1) {
      const part1 = words.slice(0, bestSplitIndex).join(' ') + '…';
      let part2 = words.slice(bestSplitIndex).join(' ');
      part2 = part2.charAt(0).toUpperCase() + part2.slice(1);
      if (!/[.!?…]$/.test(part2)) part2 += '.';
      return [part1.charAt(0).toUpperCase() + part1.slice(1), part2];
    }
  }

  // Nếu chỉ có 1 câu ngắn, trả về 1 vế hoàn chỉnh
  let single = clean.charAt(0).toUpperCase() + clean.slice(1);
  if (!/[.!?…]$/.test(single)) single += '.';
  return [single];
}

/**
 * Tạo danh sách câu chữ (sceneTexts) thích ứng theo đúng bối cảnh của từng bộ ảnh
 * @param {Object} params
 * @param {string} params.title - Tiêu đề gốc của bài viết (tiếng Trung hoặc tiếng Việt)
 * @param {string} params.moodQuote - Câu trích dẫn / tâm trạng tiếng Việt dịch từ tiêu đề
 * @param {number} params.sceneCount - Số lượng cảnh của slideshow (mặc định 4)
 * @param {string} params.seed - Giá trị dùng để tạo tính ngẫu nhiên đa dạng (URL, photoId, hoặc title)
 * @returns {string[]} Danh sách các câu cho từng cảnh
 */
export function generateStoryScenes({ title = '', moodQuote = '', sceneCount = 4, seed = '' } = {}) {
  const targetCount = Math.max(2, Math.min(sceneCount || 4, 8));
  const fullContextText = `${title || ''} ${moodQuote || ''}`.trim();
  const topic = detectStoryTopic(fullContextText);
  const presets = TOPIC_PRESETS[topic] || TOPIC_PRESETS.peaceful;
  const hash = stringHash(`${seed || title || moodQuote || 'story'}`);
  const presetIndex = hash % presets.length;
  const fallbackStory = presets[presetIndex];

  // Ưu tiên 1: Tách từ moodQuote nếu có nội dung cụ thể (không phải là câu chung chung)
  const isGenericQuote = !moodQuote || /^(Khoảnh khắc bình yên|Peaceful moments|Bình yên|Ảnh đẹp)$/i.test(cleanSentence(moodQuote));
  
  if (!isGenericQuote) {
    const beatsFromQuote = splitQuoteToBeats(moodQuote, targetCount);
    
    if (beatsFromQuote.length >= 2) {
      // Nếu tách được từ 2 vế trở lên từ quote gốc của tác giả
      if (beatsFromQuote.length >= targetCount) {
        return beatsFromQuote.slice(0, targetCount);
      }
      
      // Nếu có 2-3 vế nhưng video có nhiều cảnh hơn, bổ sung thêm câu kết phù hợp từ chủ đề
      const result = [...beatsFromQuote];
      const closingLines = [
        'Mong bạn luôn tìm thấy bình yên cho riêng mình.',
        'Chúc bạn luôn vững bước trên con đường đã chọn.',
        'Hãy để những điều dịu dàng này sưởi ấm tâm hồn bạn.',
        'Một chút dịu dàng gửi đến ngày hôm nay của bạn.',
        'Bạn muốn cùng ai lưu giữ khoảnh khắc này?'
      ];
      const closingLine = closingLines[hash % closingLines.length];
      if (result.length < targetCount) {
        result.push(closingLine);
      }
      return result.slice(0, targetCount);
    } else if (beatsFromQuote.length === 1 && beatsFromQuote[0].length >= 20) {
      // Có 1 câu quote hay nhưng không tách được: lấy câu này làm cảnh đầu tiên, các cảnh sau phát triển theo chủ đề
      const result = [beatsFromQuote[0]];
      for (const line of fallbackStory) {
        if (result.length >= targetCount) break;
        if (!result.includes(line)) result.push(line);
      }
      return result.slice(0, targetCount);
    }
  }

  // Ưu tiên 2: Sử dụng bộ câu chuyện theo chủ đề đã nhận diện, luân phiên theo hash để không trùng lặp
  return fallbackStory.slice(0, targetCount);
}
