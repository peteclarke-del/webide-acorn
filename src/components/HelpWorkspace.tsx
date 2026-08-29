import { useEffect, useMemo, useState } from 'react';
import { HELP_CATEGORIES, HELP_TOPICS, searchHelpTopics } from '../help/helpTopics';

function initialTopicId() {
  const match = location.hash.match(/^#help\/([a-z0-9-]+)$/);
  return match && HELP_TOPICS.some((topic) => topic.id === match[1]) ? match[1] : HELP_TOPICS[0]!.id;
}

export function HelpWorkspace() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [topicId, setTopicId] = useState(initialTopicId);
  const results = useMemo(() => searchHelpTopics(query, category), [query, category]);
  const topic = results.find((item) => item.id === topicId) ?? results[0] ?? HELP_TOPICS.find((item) => item.id === topicId) ?? HELP_TOPICS[0]!;
  const topicIndex = HELP_TOPICS.findIndex((item) => item.id === topic.id);

  useEffect(() => { history.replaceState(null, '', `#help/${topic.id}`); }, [topic.id]);
  useEffect(() => {
    const followDeepLink = () => setTopicId(initialTopicId());
    addEventListener('hashchange', followDeepLink);
    return () => removeEventListener('hashchange', followDeepLink);
  }, []);

  const selectTopic = (id: string) => {
    if (!results.some((item) => item.id === id)) { setQuery(''); setCategory('All'); }
    setTopicId(id);
    document.querySelector<HTMLElement>('.help-article')?.focus();
  };
  const numbered = (title: string, items: string[]) => <section><h2>{title}</h2><ol>{items.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ol></section>;
  const listed = (title: string, items: string[]) => <section><h2>{title}</h2><ul>{items.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul></section>;

  return <div className="help-workspace">
    <aside className="help-navigation" aria-label="In-app help navigation">
      <div className="help-title"><span className="eyebrow">TECHNICAL USER GUIDE</span><h1>Acorn IDE Help</h1><small>{HELP_TOPICS.length} maintained topics</small></div>
      <label><span>Search help</span><input type="search" aria-label="Search in-app help" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="build, breakpoint, ROM, shortcut" /></label>
      <label><span>Category</span><select aria-label="Filter help category" value={category} onChange={(event) => setCategory(event.target.value)}>{HELP_CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select></label>
      <nav aria-label="Help topics">{results.map((item) => <button type="button" aria-current={item.id === topic.id ? 'page' : undefined} className={item.id === topic.id ? 'active' : ''} key={item.id} onClick={() => selectTopic(item.id)}><span>{item.category}</span><strong>{item.title}</strong></button>)}{!results.length && <div className="honest-empty">No help topic matches this search and category.</div>}</nav>
    </aside>
    <article className="help-article" tabIndex={-1} aria-labelledby="help-topic-title">
      <header><span>{topic.category} · USER GUIDE</span><h1 id="help-topic-title">{topic.title}</h1><p>{topic.summary}</p></header>
      {topic.screenshot && <figure><img src={topic.screenshot.src} alt={topic.screenshot.alt} /><figcaption>{topic.screenshot.caption}<small>Captured from {topic.screenshot.captured}</small></figcaption></figure>}
      {listed('Before you begin', topic.prerequisites)}
      {numbered('Procedure', topic.steps)}
      {listed('Expected result', topic.expected)}
      {listed('Limits and target differences', topic.limitations)}
      {listed('Recovery and diagnosis', topic.recovery)}
      <section><h2>Related topics</h2><div className="help-related">{topic.related.map((id) => { const related = HELP_TOPICS.find((item) => item.id === id); return related ? <button type="button" key={id} onClick={() => selectTopic(id)}>{related.title}</button> : null; })}</div></section>
      <footer><button type="button" disabled={topicIndex <= 0} onClick={() => selectTopic(HELP_TOPICS[topicIndex - 1]!.id)}>Previous topic</button><span>{topicIndex + 1} of {HELP_TOPICS.length}</span><button type="button" disabled={topicIndex >= HELP_TOPICS.length - 1} onClick={() => selectTopic(HELP_TOPICS[topicIndex + 1]!.id)}>Next topic</button></footer>
    </article>
  </div>;
}
