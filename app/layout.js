import "./globals.css";
import "./search-overrides.css";

export const metadata = {
  title: "Afiliado Ofertas",
  description: "Encontre ofertas, prepare links e mensagens para WhatsApp.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
