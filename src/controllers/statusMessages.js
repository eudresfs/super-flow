// statusMessages.js
const fs = require('fs');
const path = require('path');

const getBase64Image = (imageName) => {
  try {
    const imagePath = path.join(__dirname, '../controllers/assets', imageName);
    return `${fs.readFileSync(imagePath).toString('base64')}`;
  } catch (error) {
    console.error(`Erro ao carregar imagem ${imageName}:`, error);
    return '';
  }
};

const STATUS_MESSAGES = {
  "em analise": {
    status: "analise",
    title: "Analisando seu empréstimo",
    // Ícone de lupa com documentos ou gráficos
    // Cores suaves em azul, transmitindo confiança e processo em andamento
    image: getBase64Image('em-analise.png'),
    description: "Estamos avaliando seu empréstimo com todo cuidado.",
    caption: "Não se preocupe, vamos te avisar sobre cada passo do processo por mensagem.",
    cta: "",
    buttonText: "Entendi"
  },
  "qualificado": {
    status: "qualificado",
    title: "Parabéns!",
    // Ícone de lupa com documentos ou gráficos
    // Cores suaves em azul, transmitindo confiança e processo em andamento
    image: getBase64Image('em-analise.png'),
    description: "A primeira etapa de sua solicitação foi concluida com sucesso.",
    caption: "Seu cadastro agora vai passar por análise de crédito junto à Crefisa S.A., e assim que finalizar te avisaremos para completar a última etapa de sua solicitação.",
    cta: "",
    buttonText: "Entendi"
  },
  "lead": {
    status: "lead",
    title: "Parabéns!",
    // Ícone de lupa com documentos ou gráficos
    // Cores suaves em azul, transmitindo confiança e processo em andamento
    image: getBase64Image('em-analise.png'),
    description: "A primeira etapa de sua solicitação foi concluida com sucesso.",
    caption: "Seu cadastro agora vai passar por análise de crédito junto à Crefisa S.A., e assim que finalizar te avisaremos para completar a última etapa de sua solicitação.",
    cta: "",
    buttonText: "Entendi"
  },
  "cancelado": {
    status: "cancelado",
    title: "Empréstimo cancelado",
    // Ícone de círculo com X em vermelho suave
    // Evitar símbolos muito negativos ou agressivos
    image: getBase64Image('cancelado.png'),
    description: "Infelizmente seu empréstimo não pôde ser aprovado.",
    caption: "Se quiser entender melhor os motivos, entre em contato com a gente.",
    cta: "Fale com nosso atendimento!",
    buttonText: "Entendi"
  },
  "cancelado (atendimento)": {
    status: "atendimento",
    title: "Empréstimo cancelado",
    // Ícone de uma mão fazendo sinal de pare ou pause
    // Tom mais neutro, já que foi uma escolha do usuário
    image: getBase64Image('atencao.png'),
    description: "Seu empréstimo foi cancelado conforme você solicitou.",
    caption: "Se mudar de ideia, você pode solicitar um novo empréstimo quando quiser.",
    cta: "",
    buttonText: "Entendi"
  },
  "aguardando assinatura": {
    status: "assinatura",
    title: "Falta só confirmar!",
    // Ícone de uma caneta ou dedo clicando em documento
    // Cor azul ou verde clara, transmitindo ação positiva
    image: getBase64Image('assinar-contrato.png'),
    description: "Enviamos um SMS com o link para você confirmar seu contrato.",
    caption: "É rapidinho! Basta clicar no link que enviamos por mensagem no seu celular.",
    cta: "Não recebeu o SMS? [Clique aqui para receber novamente](https://wa.me/551140048024)",
    buttonText: "Ok"
  },
  "aguardando pagamento": {
    status: "pagamento",
    title: "Boa notícia!",
    // Ícone de moedas ou cédulas com setas indicando movimento
    // Cores verde e amarelo, transmitindo dinheiro/sucesso
    image: getBase64Image('aguardar-pagamento.png'),
    description: "Seu empréstimo foi aprovado e já estamos preparando o pagamento.",
    caption: "Em breve o dinheiro estará na sua conta. Aguarde mais um pouquinho!",
    cta: "",
    buttonText: "Ok"
  },
  "pago": {
    status: "pago",
    title: "Dinheiro a caminho!",
    // Ícone de check mark com cifrão ou conta bancária
    // Verde vibrante, transmitindo conclusão positiva
    image: getBase64Image('pago.png'),
    description: "Seu empréstimo foi aprovado e o pagamento já foi feito.",
    caption: "O valor pode levar até 24 horas úteis para aparecer na sua conta, dependendo do seu banco.",
    cta: "",
    buttonText: "Ok"
  },
  "em andamento": {
    status: "andamento",
    title: "Recebemos sua solicitação",
    // Ícone de documento com check mark pequeno
    // Azul claro, transmitindo início do processo
    image: getBase64Image('em-andamento.png'),
    description: "Sua solicitação de empréstimo chegou para a gente.",
    caption: "Fique tranquilo(a), vamos te avisar sobre cada etapa por mensagem.",
    cta: "",
    buttonText: "Entendi"
  },
  "pendente": {
    status: "pendente",
    title: "Precisamos da sua ajuda",
    // Ícone de documento com ponto de exclamação
    // Amarelo ou laranja, indicando atenção sem alarme
    image: getBase64Image('atencao.png'),
    description: "Está faltando algumas informações ou documentos para continuar seu empréstimo.",
    caption: "Se você já nos enviou o que pedimos, pode desconsiderar esta mensagem.",
    cta: "Precisa de ajuda? [Fale com a gente](https://wa.me/551140048024)",
    buttonText: "Ok"
  },
  "perdido": {
    status: "perdido",
    title: "Precisamos da sua ajuda",
    // Ícone de pasta com ponto de interrogação
    // Cor laranja suave, indicando necessidade de ação
    image: getBase64Image('perdido.png'),
    description: "Está faltando algumas informações ou documentos para continuar seu empréstimo.",
    caption: "Se você já nos enviou o que pedimos, pode desconsiderar esta mensagem.",
    cta: "",
    buttonText: "Ok"
  }
};

const getStatusMessage = async (status) => {
  return {
    ...(STATUS_MESSAGES[status] || STATUS_MESSAGES['em andamento'])
  };
};

module.exports = { getStatusMessage };  