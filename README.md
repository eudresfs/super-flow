# WhatsApp Flows Endpoint

Endpoint para processamento de fluxos do WhatsApp, incluindo validação de benefícios, upload de documentos e gestão de leads.

## 🚀 Quick Start

1. **Instalação**
   ```bash
   npm install
   ```

2. **Configuração**
   - Copie o arquivo `.env.example` para `.env`
   - Preencha todas as variáveis de ambiente necessárias

3. **Execução**
   ```bash
   npm start
   ```

## 🛠️ Tecnologias

- Node.js
- Express
- Axios
- Winston (Logging)
- Crypto

## 📦 Funcionalidades

- ✅ Validação de CPF/NIS
- 🔒 Criptografia de dados
- 📄 Upload de documentos
- 📍 Consulta de CEP
- 💼 Gestão de benefícios

## 🔐 Segurança

- Rate limiting por IP
- Validação de assinatura
- Criptografia de dados sensíveis
- Sanitização de logs

## 📝 Endpoints

### POST /
Endpoint principal para processamento de fluxos.

**Headers necessários:**
- `x-hub-signature-256`: Assinatura HMAC SHA256
- `Content-Type`: application/json

### GET /health
Endpoint de health check.

## ⚙️ Configuração

### Variáveis de Ambiente
- `PORT`: Porta do servidor
- `APP_SECRET`: Chave para validação de assinatura
- `PRIVATE_KEY`: Chave privada para descriptografia
- `CRM_API_KEY`: Chave da API do CRM
- etc.

## 🧪 Testes
```bash
npm test
```

## 📊 Monitoramento

O sistema inclui logs estruturados com:
- Request ID
- Métricas de duração
- Rastreamento de erros
- Health check

## ⚠️ Limites

- Rate limit: 100 requisições por minuto por IP
- Tamanho máximo de payload: 10MB
- Cache de CEP: 24 horas
- Cache de benefícios: 30 minutos

## 🤝 Contribuição

1. Fork o projeto
2. Crie sua branch (`git checkout -b feature/AmazingFeature`)
3. Commit suas mudanças (`git commit -m 'Add AmazingFeature'`)
4. Push para a branch (`git push origin feature/AmazingFeature`)
5. Abra um Pull Request

## 📱 Contato

Para suporte ou dúvidas, entre em contato com a equipe de desenvolvimento.

## 📄 Licença

Este projeto está sob a licença HeyMax.io