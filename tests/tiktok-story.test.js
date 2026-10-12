import test from 'node:test';
import assert from 'node:assert/strict';
import { detectStoryTopic, splitQuoteToBeats, generateStoryScenes } from '../tiktok-story.js';
import { wrapStory } from '../tiktok-slideshow.js';

test('detects topics correctly from Chinese, Vietnamese and English keywords', () => {
  assert.equal(detectStoryTopic('世界如此辽阔 #治愈系风景 #风景'), 'nature');
  assert.equal(detectStoryTopic('Sunset over the ocean #日落'), 'sunset');
  assert.equal(detectStoryTopic('Hôm nay trời mưa to quá #下雨'), 'rain');
  assert.equal(detectStoryTopic('Bé mèo đáng yêu #猫咪'), 'cat');
  assert.equal(detectStoryTopic('Cún con đi dạo #小狗'), 'dog');
  assert.equal(detectStoryTopic('Bữa cơm gia đình ấm cúng #美食'), 'food');
  assert.equal(detectStoryTopic('Vườn hoa hồng khoe sắc #花园'), 'garden');
  assert.equal(detectStoryTopic('Thành phố lên đèn #夜景'), 'night');
  assert.equal(detectStoryTopic('Biển chiều lộng gió #大海'), 'ocean');
  assert.equal(detectStoryTopic('Một ngày bình thường'), 'peaceful');
});

test('splits meaningful multi-clause quote into natural scene beats', () => {
  const quote = 'Thế giới rất rộng lớn, dù có đi bao xa, một ngày nào đó bạn cũng sẽ đến được đây.';
  const beats = splitQuoteToBeats(quote, 4);
  assert.ok(beats.length >= 3);
  assert.match(beats[0], /Thế giới rất rộng lớn/);
  assert.match(beats[1], /Dù có đi bao xa/);
  assert.match(beats[2], /Một ngày nào đó/);
});

test('generates context-aware story scenes from real Kuaishou post data', () => {
  // Row 78 real data
  const story78 = generateStoryScenes({
    title: '世界如此辽阔怎么走都不算错，总有一天你会抵达这里。 #治愈系风景 #风景',
    moodQuote: 'Thế giới rất rộng lớn, dù có đi bao xa, một ngày nào đó bạn cũng sẽ đến được đây.',
    sceneCount: 4
  });
  assert.equal(story78.length, 4);
  assert.match(story78[0], /Thế giới rất rộng lớn/);
  assert.notEqual(story78[0], 'Nếu được đi trốn một ngày, mình muốn đến đây.'); // Không bị dùng câu mặc định cũ!

  // Rain post
  const rainStory = generateStoryScenes({
    title: '下雨天 #雨',
    moodQuote: 'Ngày mưa',
    sceneCount: 4
  });
  assert.equal(rainStory.length, 4);
  assert.ok(rainStory.some(line => /mưa/i.test(line)));

  // Cat post
  const catStory = generateStoryScenes({
    title: '小猫咪 #猫',
    moodQuote: 'Mèo con đáng yêu',
    sceneCount: 4
  });
  assert.equal(catStory.length, 4);
  assert.ok(catStory.some(line => /mèo|cục bông|đáng yêu/i.test(line)));
});

test('different posts produce diverse and varied stories without monotony', () => {
  const sunsetA = generateStoryScenes({ title: 'Hoàng hôn A', moodQuote: '', sceneCount: 4, seed: 'photo-1' });
  const sunsetB = generateStoryScenes({ title: 'Hoàng hôn B', moodQuote: '', sceneCount: 4, seed: 'photo-2' });
  // Varied seeds produce different variations
  assert.notDeepEqual(sunsetA, sunsetB);
});

test('all generated scene lines fit safely within wrapStory boundaries', () => {
  const dummyMeasure = (text, size) => text.length * size * 0.55;
  const topics = ['sunset', 'rain', 'ocean', 'cat', 'dog', 'food', 'garden', 'night', 'love', 'nature', 'travel', 'peaceful'];
  for (const topic of topics) {
    const lines = generateStoryScenes({ title: topic, moodQuote: '', sceneCount: 4, seed: topic });
    for (const line of lines) {
      assert.doesNotThrow(() => {
        wrapStory(line, 640, 44, dummyMeasure);
      }, `Dòng chữ "${line}" bị vượt quá 2 dòng!`);
    }
  }
});
