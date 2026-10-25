// The question rule of the Comments tab (Plan 15c). ONE pattern for both engines: the badge on a row
// (JavaScript RegExp, flag i) and the Questions filter in SQL (comment_list p_question_re, operator ~*). It uses only
// syntax that means the same in both: literals, | ( ) [ ] ^ $ * + and \s. Rule-based, so the UI says so.
//
// A comment is a question when it has a question mark anywhere (? ？ ❓; a "?" glued to a letter or digit, as in a URL
// query "?id=7", is not one), or STARTS (after @mentions and spaces) with an English question word that is followed by
// a non-letter (an apostrophe is a letter: can't / don't) or the end, and has no "!" after it ("What a shot!" is an
// exclamation), or contains a Chinese question word (simplified and traditional) anywhere. English words only at the
// start: "this is great" / "show me" are not questions. "any" and "will" are left out: "Any day now" and "Will is here"
// (a name) are not questions; with a question mark they still are.
const EN = ['how', 'what', 'when', 'where', 'why', 'who', 'which', 'whose', 'can', 'could', 'do', 'does', 'did', 'is', 'are', 'would', 'should', 'anyone'];
const ZH = ['吗', '嗎', '什么', '什麼', '怎么', '怎麼', '怎样', '怎樣', '为什么', '為什麼', '哪里', '哪裡', '哪儿', '哪个', '哪個', '多少', '几时', '幾時', '是不是', '有没有', '有沒有', '能不能', '可不可以', '请问', '請問'];

export const QUESTION_PATTERN = `[?]([^a-z0-9_]|$)|[？❓]|^\\s*(@[a-z0-9._]+\\s+)*(${EN.join('|')})([^a-z'’][^!]*)?$|${ZH.join('|')}`;
const QUESTION_RE = new RegExp(QUESTION_PATTERN, 'i');
// SQL cannot strip URLs: there the "?" followed by a letter or digit is what keeps a URL query out. Here the URL is removed
// first, so a URL with any "?" never counts (the two engines only differ on a URL that ends in "?").
const URL_RE = /(https?:\/\/|www\.)\S+/gi;

export const isQuestion = (text: string | null): boolean => text !== null && QUESTION_RE.test(text.replace(URL_RE, ' '));
