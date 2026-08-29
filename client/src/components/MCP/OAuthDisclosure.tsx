import type { MCPOAuthDisclosure } from 'librechat-data-provider';

export default function OAuthDisclosure({ disclosure }: { disclosure: MCPOAuthDisclosure }) {
  return (
    <section
      aria-label={disclosure.title}
      className="space-y-3 rounded-lg border border-border-medium bg-surface-secondary p-4"
    >
      <h3 className="text-sm font-semibold text-text-primary">{disclosure.title}</h3>
      <ul className="list-disc space-y-2 pl-5 text-sm text-text-secondary">
        {disclosure.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
        {disclosure.links.map((link) => (
          <a
            key={link.url}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline dark:text-blue-400"
          >
            {link.label}
          </a>
        ))}
      </div>
    </section>
  );
}
