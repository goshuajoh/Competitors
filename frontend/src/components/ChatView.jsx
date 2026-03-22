import { useState, useRef, useEffect, useMemo } from 'react';
import { Send, Bot, User, Zap, Loader2, ChevronDown } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { fuzzyFind } from '../lib/chipData';

const QUICK_PROMPTS = [
  'Compare ESP32-S3 vs nRF5340 for a smart home hub',
  'What is the best ESP chip to replace the nRF52840?',
  'Analyze Bouffalo Lab as a competitive threat',
  'Which chips support Matter over Thread?',
  'What are the strengths and weaknesses of Nordic vs Espressif?',
  'Recommend an ESP chip for a low-power BLE wearable',
  'Compare WiFi 6 chips across all manufacturers',
  'What Chinese competitors should Espressif worry about most?',
];

export default function ChatView({ data }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [provider, setProvider] = useState('anthropic');
  const [streamingContent, setStreamingContent] = useState('');
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  // Extract chip names from text and return relevant chip data
  const extractChipContext = (text) => {
    const chips = [];
    const words = text.toUpperCase().replace(/[^A-Z0-9\- ]/g, ' ').split(/\s+/);

    for (const chip of data.allChips) {
      const model = chip.chip_model.toUpperCase();
      const family = (chip.chip_family || '').toUpperCase();
      const mfr = chip._manufacturer.toUpperCase();

      if (
        words.some((w) => model.includes(w) && w.length > 3) ||
        text.toUpperCase().includes(model) ||
        text.toUpperCase().includes(mfr)
      ) {
        chips.push(chip);
      }
    }

    // If no specific chips mentioned, check for manufacturer names
    if (chips.length === 0) {
      for (const [mfr, mfrChips] of data.chipsByManufacturer.entries()) {
        if (text.toUpperCase().includes(mfr.toUpperCase())) {
          chips.push(...mfrChips);
        }
      }
    }

    // If still nothing and it's a general question, include a summary
    if (chips.length === 0) {
      // Return a light summary of all manufacturers
      const summary = {};
      for (const [mfr, mfrChips] of data.chipsByManufacturer.entries()) {
        summary[mfr] = mfrChips.map((c) => {
          const ieee = c.connectivity?.ieee802154;
          return {
            model: c.chip_model,
            wifi: !!c.connectivity?.wifi?.supported,
            ble: !!c.connectivity?.bluetooth?.supported,
            thread: !!ieee?.thread || (ieee?.protocols || []).some((p) => p.toLowerCase().includes('thread')),
            matter: !!c.connectivity?.matter_support,
            matter_over_thread: !!ieee?.matter_over_thread,
            cpu_mhz: c.processing?.max_clock_mhz,
            sram_kb: c.memory?.sram_kb,
            arch: c.processing?.cpu_architecture,
            status: c.status,
          };
        });
      }
      return { type: 'summary', data: summary };
    }

    // Limit context to avoid token explosion
    const limited = chips.slice(0, 10);
    return { type: 'chips', data: limited.map(stripInternalFields) };
  };

  const stripInternalFields = (chip) => {
    const cleaned = {};
    for (const [k, v] of Object.entries(chip)) {
      if (!k.startsWith('_')) cleaned[k] = v;
    }
    cleaned._manufacturer = chip._manufacturer;
    return cleaned;
  };

  const sendMessage = async (text) => {
    if (!text.trim() || loading) return;

    const userMsg = { role: 'user', content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setLoading(true);
    setStreamingContent('');

    try {
      const chipContext = extractChipContext(text);

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages.map((m) => ({ role: m.role, content: m.content })),
          provider,
          chipContext,
          totalChips: data.allChips.length,
          totalManufacturers: data.chipsByManufacturer.size,
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Server error' }));
        throw new Error(err.error || `Server error: ${response.status}`);
      }

      // Stream response
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') break;
            try {
              const parsed = JSON.parse(data);
              if (parsed.content) {
                fullContent += parsed.content;
                setStreamingContent(fullContent);
              }
              if (parsed.error) {
                throw new Error(parsed.error);
              }
            } catch (e) {
              if (e.message !== 'Unexpected end of JSON input') {
                // Just append as text if JSON parse fails
                fullContent += data;
                setStreamingContent(fullContent);
              }
            }
          }
        }
      }

      setMessages([...newMessages, { role: 'assistant', content: fullContent }]);
      setStreamingContent('');
    } catch (err) {
      setMessages([
        ...newMessages,
        { role: 'assistant', content: `**Error:** ${err.message}\n\nMake sure the backend server is running (\`node server.js\`) and your API key is set in \`.env\`.` },
      ]);
      setStreamingContent('');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-gray-800 px-4 md:px-6 py-3 flex items-center justify-between flex-wrap gap-2 shrink-0">
        <div className="flex items-center gap-2">
          <Bot size={20} className="text-blue-400" />
          <h2 className="text-lg font-semibold text-white">AI Chip Analyst</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Provider:</span>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none"
          >
            <option value="anthropic">Claude (Anthropic)</option>
            <option value="openai">GPT-4o (OpenAI)</option>
          </select>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 md:px-6 py-4 space-y-4">
        {messages.length === 0 && !loading && (
          <div className="mt-8">
            <div className="text-center mb-8">
              <Zap size={40} className="text-blue-400 mx-auto mb-3" />
              <h3 className="text-xl font-bold text-white mb-2">Chip Knowledge Graph AI</h3>
              <p className="text-gray-500 text-sm max-w-md mx-auto">
                Ask questions about {data.allChips.length} chips across {data.chipsByManufacturer.size} manufacturers.
                I'll use the knowledge graph for data-driven analysis.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-w-2xl mx-auto">
              {QUICK_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => sendMessage(prompt)}
                  className="text-left text-sm text-gray-400 bg-gray-900 hover:bg-gray-800 border border-gray-800 hover:border-gray-700 rounded-lg px-4 py-3.5 min-h-[48px] transition-colors"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <MessageBubble key={i} message={msg} />
        ))}

        {loading && streamingContent && (
          <MessageBubble message={{ role: 'assistant', content: streamingContent }} streaming />
        )}

        {loading && !streamingContent && (
          <div className="flex items-center gap-2 text-gray-500 text-sm">
            <Loader2 size={16} className="animate-spin" />
            Thinking...
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-800 px-3 md:px-6 py-3 md:py-4 shrink-0" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
        <div className="flex gap-3 max-w-4xl">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about chips, comparisons, recommendations..."
            rows={1}
            className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none resize-none"
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || loading}
            className="bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white px-4 py-2.5 rounded-lg transition-colors"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message, streaming }) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex gap-3 ${isUser ? 'justify-end' : ''}`}>
      {!isUser && (
        <div className="w-8 h-8 rounded-lg bg-blue-600/20 flex items-center justify-center shrink-0 mt-0.5">
          <Bot size={16} className="text-blue-400" />
        </div>
      )}
      <div
        className={`max-w-[85%] md:max-w-[75%] rounded-xl px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? 'bg-blue-600 text-white'
            : 'bg-gray-900 border border-gray-800 text-gray-200'
        }`}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <div className="chat-markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ table: ({ children }) => <div className="table-wrapper"><table>{children}</table></div> }}>{message.content}</ReactMarkdown>
            {streaming && <span className="inline-block w-2 h-4 bg-blue-400 animate-pulse ml-0.5" />}
          </div>
        )}
      </div>
      {isUser && (
        <div className="w-8 h-8 rounded-lg bg-gray-700 flex items-center justify-center shrink-0 mt-0.5">
          <User size={16} className="text-gray-300" />
        </div>
      )}
    </div>
  );
}
