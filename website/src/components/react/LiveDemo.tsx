import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

const conversation: Message[] = [
  { id: '1', role: 'assistant', content: "Hey! I'm your AI assistant powered by ChatCops. How can I help?" },
  { id: '2', role: 'user', content: 'What pricing plans do you offer?' },
  {
    id: '3',
    role: 'assistant',
    content:
      "We have three plans: **Starter** (free), **Pro** ($29/mo), and **Enterprise** (custom). All include unlimited conversations and every integration. Want me to help you choose?",
  },
];

export default function LiveDemo() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [typing, setTyping] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let step = 0;
    const delays = [500, 1400, 900];

    function next() {
      if (step >= conversation.length) return;
      const msg = conversation[step];

      if (msg.role === 'assistant' && step > 0) {
        setTyping(true);
        setTimeout(() => {
          setTyping(false);
          streamMsg(msg);
          step++;
          setTimeout(next, delays[step] || 1000);
        }, 1200);
      } else {
        setMessages((p) => [...p, msg]);
        step++;
        setTimeout(next, delays[step] || 900);
      }
    }

    function streamMsg(msg: Message) {
      const words = msg.content.split(' ');
      let i = 0;
      setMessages((p) => [...p, { ...msg, content: '' }]);

      const iv = setInterval(() => {
        if (i >= words.length) {
          clearInterval(iv);
          setMessages((p) => p.map((m) => (m.id === msg.id ? { ...m, content: msg.content } : m)));
          return;
        }
        i++;
        const partial = words.slice(0, i).join(' ');
        setMessages((p) => p.map((m) => (m.id === msg.id ? { ...m, content: partial } : m)));
      }, 35);
    }

    const t = setTimeout(next, 700);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' });
  }, [messages, typing]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="mx-auto w-full max-w-[380px]"
    >
      <div className="rounded-2xl border border-border bg-bg-surface overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-border">
          <div className="relative">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
              C
            </div>
            <div className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-bg-surface bg-emerald-400" />
          </div>
          <div>
            <div className="text-sm font-medium text-text">ChatCops</div>
            <div className="text-[11px] text-text-muted">Always online</div>
          </div>
        </div>

        {/* Messages */}
        <div ref={ref} className="h-[260px] overflow-y-auto p-4 space-y-3">
          <AnimatePresence>
            {messages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-primary text-white rounded-br-lg'
                      : 'bg-bg-elevated text-text-secondary rounded-bl-lg border border-border'
                  }`}
                >
                  {formatText(msg.content)}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {typing && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex justify-start"
            >
              <div className="flex gap-1.5 rounded-2xl bg-bg-elevated px-4 py-3 rounded-bl-lg border border-border">
                {[0, 1, 2].map((i) => (
                  <motion.span
                    key={i}
                    className="h-1.5 w-1.5 rounded-full bg-text-muted"
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.2 }}
                  />
                ))}
              </div>
            </motion.div>
          )}
        </div>

        {/* Input */}
        <div className="flex items-center gap-2 border-t border-border px-3 py-3">
          <div className="flex-1 rounded-xl bg-bg-elevated border border-border px-3.5 py-2 text-[13px] text-text-muted">
            Type a message...
          </div>
          <button className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-white transition-colors hover:bg-primary-dark">
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 -rotate-45">
              <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
            </svg>
          </button>
        </div>
      </div>
    </motion.div>
  );
}

function formatText(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="font-semibold text-text">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return part;
  });
}
