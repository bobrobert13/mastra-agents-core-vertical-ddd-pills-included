import { describe, it, expect } from 'vitest';
import {
  htmlToText,
  extractHtmlTitle,
  mapDuckDuckGoResults,
} from '../../../../../src/mastra/domains/research/functions/web-parse';

describe('htmlToText', () => {
  it('drops script/style, strips tags and collapses whitespace', () => {
    const html =
      '<html><head><style>.a{color:red}</style></head><body>' +
      '<script>window.x = 1;</script>' +
      '<h1>Title</h1><p>Hello   <b>world</b></p></body></html>';

    const text = htmlToText(html);

    expect(text).not.toContain('window.x');
    expect(text).not.toContain('color:red');
    expect(text).not.toContain('<');
    expect(text).toBe('Title Hello world');
  });
});

describe('extractHtmlTitle', () => {
  it('extracts the <title> content when present', () => {
    expect(extractHtmlTitle('<head><title>Clean Fixture</title></head>')).toBe('Clean Fixture');
    expect(extractHtmlTitle('<title class="x">Hi</title>')).toBe('Hi');
  });

  it('returns undefined without a <title>', () => {
    expect(extractHtmlTitle('<body>no title here</body>')).toBeUndefined();
  });
});

describe('mapDuckDuckGoResults', () => {
  it('maps the Abstract to the first result', () => {
    const data = { Abstract: 'An abstract.', AbstractURL: 'https://a.test', Heading: 'A' };
    expect(mapDuckDuckGoResults(data, 5)).toEqual([
      { title: 'A', url: 'https://a.test', snippet: 'An abstract.' },
    ]);
  });

  it('defaults the abstract title to "Summary" and the url to ""', () => {
    expect(mapDuckDuckGoResults({ Abstract: 'x' }, 5)).toEqual([
      { title: 'Summary', url: '', snippet: 'x' },
    ]);
  });

  it('appends RelatedTopics after the Abstract and respects maxResults', () => {
    const data = {
      Abstract: 'lead',
      AbstractURL: 'https://lead.test',
      Heading: 'Lead',
      RelatedTopics: [
        { Text: 'First topic - extra', FirstURL: 'https://1.test' },
        { Text: 'Second topic', FirstURL: 'https://2.test' },
        { Text: 'Third topic', FirstURL: 'https://3.test' },
      ],
    };
    const results = mapDuckDuckGoResults(data, 2);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ title: 'Lead', url: 'https://lead.test', snippet: 'lead' });
    expect(results[1]).toEqual({
      title: 'First topic',
      url: 'https://1.test',
      snippet: 'First topic - extra',
    });
  });

  it('skips topics missing Text/FirstURL and returns [] on empty data', () => {
    expect(mapDuckDuckGoResults({ RelatedTopics: [{ Text: 'no url' }, { FirstURL: 'x' }] }, 5)).toEqual(
      []
    );
    expect(mapDuckDuckGoResults({}, 5)).toEqual([]);
    expect(mapDuckDuckGoResults(null, 5)).toEqual([]);
  });
});
