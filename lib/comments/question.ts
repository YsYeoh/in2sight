// The question rule of the Comments tab (Plan 15c). ONE pattern for both engines: the badge on a row
// (JavaScript RegExp, flag i) and the Questions filter in SQL (comment_list p_question_re, operator ~*). It uses only
// syntax that means the same in both: literals, | ( ) [ ] ^ $ * + and \s. Rule-based, so the UI says so.
//
// A comment is a question when it has a question mark anywhere (? ？ ❓), or STARTS (after @mentions and spaces) with
// an English question word followed by a non-letter or the end, or contains a Chinese question word (simplified and
// traditional) anywhere. English words only at the start: "this is great" / "show me" are not questions.
const EN = ['how', 'what', 'when', 'where', 'why', 'who', 'which', 'whose', 'can', 'could', 'do', 'does', 'did', 'is', 'are', 'will', 'would', 'should', 'any', 'anyone'];
const ZH = ['吗', '嗎', '什么', '什麼', '怎么', '怎麼', '怎样', '怎樣', '为什么', '為什麼', '哪里', '哪裡', '哪儿', '哪个', '哪個', '多少', '几时', '幾時', '是不是', '有没有', '有沒有', '能不能', '可不可以', '请问', '請問'];

export const QUESTION_PATTERN = `[?？❓]|^\\s*(@[a-z0-9._]+\\s+)*(${EN.join('|')})([^a-z]|$)|${ZH.join('|')}`;
const QUESTION_RE = new RegExp(QUESTION_PATTERN, 'i');

export const isQuestion = (text: string | null): boolean => text !== null && QUESTION_RE.test(text);
