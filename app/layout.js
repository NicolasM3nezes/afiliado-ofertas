import "./globals.css";
import "./search-overrides.css";
import "./connections-overrides.css";
import "./affiliate-overrides.css";
import "./audit-overrides.css";

export const metadata = {
  title: "Afiliado Ofertas",
  description: "Encontre ofertas, prepare links e mensagens para WhatsApp.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
