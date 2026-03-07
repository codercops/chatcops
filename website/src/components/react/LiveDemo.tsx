import { useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { Widget } from '@chatcops/widget';

export default function LiveDemo() {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<Widget | null>(null);

  useEffect(() => {
    if (widgetRef.current || !containerRef.current) return;

    const widget = new Widget({
      apiUrl: '/api/chat',
      mode: 'inline',
      container: containerRef.current,
      welcomeMessage: "Hey! I'm your AI assistant powered by ChatCops. Ask me anything!",
      branding: {
        name: 'ChatCops',
        subtitle: 'Always online',
      },
      theme: {
        accent: '#6366f1',
      },
      persistHistory: false,
    });
    widget.init();
    widgetRef.current = widget;

    return () => {
      widget.destroy();
      widgetRef.current = null;
    };
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="mx-auto w-full max-w-[400px]"
    >
      <div
        ref={containerRef}
        style={{ width: '100%', height: '500px', borderRadius: '12px', overflow: 'hidden' }}
      />
      <p className="text-center text-xs text-text-muted mt-3">
        This is the actual ChatCops widget running in inline mode.
      </p>
    </motion.div>
  );
}
