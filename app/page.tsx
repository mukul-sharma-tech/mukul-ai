'use client';

import { useState, useRef, useEffect, FormEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import NeonBackground from './components/NeonBackground';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatResponse {
  success: boolean;
  response: string;
}

function sanitizeLLMOutput(text: string): string {
  return text.replace(/<br\s*\/?>/gi, '\n');
}

const SUGGESTIONS = [
  'Why are you fit for this role?',
  'Tell me about your internships',
  'What AI projects have you built?',
  'LangGraph experience?',
];

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput('');
    inputRef.current?.focus();
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setIsLoading(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          conversationHistory: messages.slice(-5).map(m => ({ role: m.role, content: m.content })),
        }),
      });
      const data: ChatResponse = await response.json();
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data.success ? data.response : 'Something went wrong. Please try again.',
      }]);
    } catch {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Could not reach the server. Make sure Ollama is running.',
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-screen text-white">
      <NeonBackground />

      {/* ── Header ── */}
      <header className="shrink-0 z-20 border-b border-white/5 bg-black/30 backdrop-blur-xl">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Neon avatar */}
            <div className="relative w-8 h-8">
              <div className="absolute inset-0 rounded-full bg-violet-500 blur-[6px] opacity-70 animate-pulse" />
              <div className="relative w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 via-fuchsia-500 to-cyan-500 flex items-center justify-center text-white text-xs font-bold">
                M
              </div>
            </div>
            <div>
              <p className="text-sm font-semibold text-white leading-none">Mukul Sharma</p>
              <p className="text-[11px] text-white/40 leading-none mt-0.5">AI Engineer · Portfolio Assistant</p>
            </div>
          </div>
          <a href="https://mukul-sharma-dev.vercel.app/" target="_blank" rel="noopener noreferrer"
            className="text-xs font-medium text-cyan-400 hover:text-cyan-300 transition-colors">
            Portfolio ↗
          </a>
        </div>
      </header>

      {/* ── Messages ── */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-5">

          {/* Empty state */}
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center min-h-[55vh] text-center select-none">
              {/* Neon logo */}
              <div className="relative w-16 h-16 mb-6">
                <div className="absolute inset-0 rounded-2xl bg-violet-500 blur-[16px] opacity-60 animate-pulse" />
                <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-600 via-fuchsia-500 to-cyan-500 flex items-center justify-center text-white text-2xl font-bold shadow-lg">
                  M
                </div>
              </div>
              <h1 className="text-2xl sm:text-3xl font-semibold text-white mb-2 tracking-tight">
                Hi, I&apos;m Mukul&apos;s AI
              </h1>
              <p className="text-sm text-white/40 max-w-xs mb-8">
                Ask about experience, projects, or fit for the Scaler AI Engineer role.
              </p>
              <div className="flex flex-wrap gap-2 justify-center">
                {SUGGESTIONS.map(s => (
                  <button key={s} onClick={() => { setInput(s); inputRef.current?.focus(); }}
                    className="px-3.5 py-2 rounded-full border border-white/10 bg-white/5 text-white/60 text-xs font-medium hover:border-violet-400/60 hover:text-violet-300 hover:bg-violet-500/10 transition-all">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Message list */}
          {messages.map((msg, i) => (
            <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>

              {/* Assistant neon avatar */}
              {msg.role === 'assistant' && (
                <div className="relative shrink-0 w-7 h-7 mt-0.5">
                  <div className="absolute inset-0 rounded-full bg-violet-500 blur-[5px] opacity-50" />
                  <div className="relative w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center text-white text-[10px] font-bold">
                    M
                  </div>
                </div>
              )}

              <div className={`
                rounded-2xl px-4 py-3 text-sm leading-relaxed
                ${msg.role === 'user'
                  ? 'max-w-[70%] bg-gradient-to-br from-violet-600 to-fuchsia-600 text-white rounded-tr-sm shadow-lg shadow-violet-500/20'
                  : 'w-full sm:max-w-[85%] bg-black/40 border border-white/8 backdrop-blur-sm rounded-tl-sm'
                }
              `}>
                {msg.role === 'user' ? (
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                ) : (
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      h1: ({ children }) => <h1 className="text-base font-semibold text-white mt-3 mb-1.5">{children}</h1>,
                      h2: ({ children }) => <h2 className="text-sm font-semibold text-white mt-3 mb-1 pb-1 border-b border-white/10">{children}</h2>,
                      h3: ({ children }) => <h3 className="text-sm font-medium text-cyan-400 mt-2 mb-0.5">{children}</h3>,
                      p: ({ children }) => <p className="text-white/80 mb-2 leading-relaxed text-sm">{children}</p>,
                      strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
                      em: ({ children }) => <em className="text-white/50">{children}</em>,
                      ul: ({ children }) => <ul className="list-none ml-0 my-1.5 space-y-1">{children}</ul>,
                      ol: ({ children }) => <ol className="list-decimal ml-4 my-1.5 space-y-1 text-white/80 text-sm">{children}</ol>,
                      li: ({ children }) => (
                        <li className="flex gap-2 text-white/80 text-sm">
                          <span className="text-cyan-400 mt-1.5 shrink-0 text-xs">▸</span>
                          <span>{children}</span>
                        </li>
                      ),
                      code: ({ children, className }) => {
                        const isBlock = className?.includes('language-');
                        return isBlock
                          ? <code className="block bg-black/60 border border-white/10 rounded-lg p-3 text-cyan-300 text-xs overflow-x-auto my-2 font-mono">{children}</code>
                          : <code className="bg-white/10 px-1.5 py-0.5 rounded text-cyan-300 text-xs font-mono">{children}</code>;
                      },
                      blockquote: ({ children }) => (
                        <blockquote className="border-l-2 border-violet-400 pl-3 my-2 text-white/40 italic text-sm">{children}</blockquote>
                      ),
                      hr: () => <hr className="border-white/10 my-3" />,
                      table: ({ children }) => (
                        <div className="overflow-x-auto my-3 rounded-lg border border-white/10">
                          <table className="w-full border-collapse text-xs">{children}</table>
                        </div>
                      ),
                      thead: ({ children }) => <thead className="bg-white/5">{children}</thead>,
                      tbody: ({ children }) => <tbody>{children}</tbody>,
                      tr: ({ children }) => <tr className="border-b border-white/10">{children}</tr>,
                      th: ({ children }) => <th className="px-3 py-2 text-left text-white font-medium text-xs whitespace-nowrap">{children}</th>,
                      td: ({ children }) => <td className="px-3 py-2 text-white/70 text-xs align-top">{children}</td>,
                      a: ({ href, children }) => (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2 decoration-cyan-400/50 hover:decoration-cyan-300 transition-colors"
                        >
                          {children}
                        </a>
                      ),
                    }}
                  >
                    {sanitizeLLMOutput(msg.content)}
                  </ReactMarkdown>
                )}
              </div>

              {/* User avatar */}
              {msg.role === 'user' && (
                <div className="shrink-0 w-7 h-7 rounded-full bg-white/10 border border-white/10 flex items-center justify-center text-white/60 text-[10px] font-bold mt-0.5">
                  U
                </div>
              )}
            </div>
          ))}

          {/* Typing dots */}
          {isLoading && (
            <div className="flex gap-3 justify-start">
              <div className="relative shrink-0 w-7 h-7 mt-0.5">
                <div className="absolute inset-0 rounded-full bg-violet-500 blur-[5px] opacity-50" />
                <div className="relative w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center text-white text-[10px] font-bold">
                  M
                </div>
              </div>
              <div className="bg-black/40 border border-white/8 backdrop-blur-sm rounded-2xl rounded-tl-sm px-4 py-3.5">
                <div className="flex items-center gap-1.5">
                  {[0, 160, 320].map(d => (
                    <span key={d} className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce"
                      style={{ animationDelay: `${d}ms` }} />
                  ))}
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* ── Input ── */}
      <div className="shrink-0 z-20 border-t border-white/5 bg-black/30 backdrop-blur-xl">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4">
          <form onSubmit={handleSubmit}>
            <div className="relative flex items-center gap-2 bg-white/5 border border-white/10 rounded-2xl px-4 py-2.5
              focus-within:border-violet-500/60 focus-within:bg-white/8 focus-within:shadow-[0_0_20px_rgba(139,92,246,0.15)]
              transition-all duration-300">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder="Ask anything"
                disabled={isLoading}
                className="flex-1 bg-transparent text-sm text-white placeholder-white/25 outline-none disabled:opacity-40 sm:hidden"
              />
              <input
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder="Ask about Mukul's experience, projects, skills…"
                disabled={isLoading}
                className="flex-1 bg-transparent text-sm text-white placeholder-white/25 outline-none disabled:opacity-40 hidden sm:block"
              />
              <button type="submit" disabled={isLoading || !input.trim()} aria-label="Send"
                className="shrink-0 w-8 h-8 rounded-xl bg-gradient-to-br from-violet-600 to-fuchsia-600
                  hover:from-violet-500 hover:to-fuchsia-500
                  disabled:from-white/10 disabled:to-white/10 disabled:cursor-not-allowed
                  flex items-center justify-center transition-all duration-200
                  shadow-[0_0_12px_rgba(139,92,246,0.4)] disabled:shadow-none">
                <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                </svg>
              </button>
            </div>
          </form>
          <p className="text-center text-[11px] text-white/20 mt-2">
            Grounded on Mukul&apos;s actual resume and GitHub repos
          </p>
        </div>
      </div>
    </div>
  );
}
