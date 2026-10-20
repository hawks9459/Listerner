# Listener

Ambiente web estático para desafios de lógica de programação da equipe RPRT HAWKS. A aplicação ativa é `index.html`; a interface não usa servidor de aplicação nem dependências npm em tempo de execução.

## Executar localmente

Requer Node.js 24 ou superior para a suíte de testes. Para testar a aplicação, sirva os arquivos em `localhost` (necessário para permissões de microfone em navegadores compatíveis):

```powershell
Set-Location C:\caminho\para\Listener
py -m http.server 8000
```

Se Python não estiver instalado, abra a pasta no VS Code e use uma extensão de servidor estático, como Live Server. Acesse `http://localhost:8000/`.

Execute os testes técnicos com:

```powershell
npm test
```

Não há dependências externas declaradas no `package.json`; o comando executa os testes nativos do Node.js.

## Publicação estática

Publique por HTTPS em qualquer hospedagem estática (por exemplo, GitHub Pages). A URL de entrada é a raiz do domínio (`<domínio>/`); o GitHub Pages serve `index.html` diretamente. Preserve os caminhos e nomes relativos dos ativos.

Arquivos indispensáveis:

- `index.html`
- `listener.css` e `listener-game.css`
- `listener-engine.js`, `listener-missions.js`, `listener-voice.js`, `listener-learning.js`, `listener-game.js` e `listener.js`
- `Questrial-Regular.ttf`, `Nau Sea.otf` e `Adumu.ttf`
- `hawk-transparent.png` e `listenerreal-removebg-preview.png`

`listener-engine.test.js`, `listener-missions.test.js`, `listener-voice.test.js`, `listener-learning.test.js`, `listener-session-store.test.js` e `package.json` são necessários para desenvolvimento/testes, não para executar a aplicação publicada. Não publique `listenerp(1).html` (referência legada), os ZIPs de backup nem `desktop.ini`; eles não fazem parte da aplicação ativa.

## Integrações e configuração

O fluxo final de avaliação está ligado ao endpoint de Apps Script configurado em `window.LISTENER_CONFIG.sessionEndpoint` no `index.html`. O jogo envia um `POST` cujo corpo é JSON e cujo `Content-Type` é `text/plain;charset=utf-8`, para evitar preflight CORS. A chave idempotente (`<sessionId>:<action>`) é enviada no campo `idempotencyKey` do corpo; o Apps Script não consegue ler cabeçalhos da requisição, por isso a chave fica no corpo.

O contrato do Apps Script deve ser:

- `doPost(e)` lê os dados com `JSON.parse(e.postData.contents)`.
- `action: "register-session"` cria a linha inicial.
- `action: "complete-session"` atualiza a mesma linha encontrada pelo `sessionId`; não insere outra linha.
- Depois de confirmar a gravação, responde com `ContentService.createTextOutput(JSON.stringify({success:true, sessionId})).setMimeType(ContentService.MimeType.JSON)`.
- Implante como Aplicativo da Web, executando como "Eu", com acesso "Qualquer pessoa". Publique uma NOVA versão após cada alteração no Apps Script.

A resposta deve chegar com HTTP de sucesso e JSON `{ "success": true, "sessionId": "<mesmo-id>" }`. O serviço deve preservar os dados iniciais e responder apenas após confirmar a gravação. Se o envio não for confirmado, a avaliação é mantida como pendente localmente e a interface não afirma que foi enviada.

O widget oficial VLibras é carregado uma única vez pelo script incluído em `index.html`; a inicialização é automática e não há widget reproduzido manualmente nem inicialização adicional. Como a navegação entre as telas é dinâmica, o mesmo widget permanece disponível sem recarregar o script. Textos HTML selecionáveis podem ser traduzidos pelo widget; textos desenhados em imagens ou canvas não são traduzidos automaticamente.

## Voz e leitura em voz alta

- Teste o microfone em `localhost` ou HTTPS, em navegador compatível; conceda a permissão quando solicitada. A disponibilidade e a qualidade do reconhecimento dependem do navegador, do sistema operacional, do dispositivo e, em alguns casos, de uma conexão externa. Os blocos continuam disponíveis quando o reconhecimento de voz não é oferecido ou falha.
- A leitura em voz alta usa a síntese de fala do navegador e as vozes instaladas. Teste os controles “Ouvir desafio atual” e “Interromper”; idiomas e vozes disponíveis variam entre dispositivos.

## Fluxos existentes e pendências

A aplicação ativa inclui splash, início, Sobre o projeto, questionário inicial, trilha com três fundamentos e seis desafios, tela de conclusão por desafio, desempenho e configurações. O progresso validado é guardado localmente neste navegador; não há contas nem sincronização entre dispositivos.

Após concluir os seis desafios validados, a aplicação oferece uma mensagem de parabéns e uma avaliação com comentário opcional. A avaliação não altera pontos ou progresso. O botão “Finalizar sessão” limpa o estado ativo do participante, mantém somente envios ainda pendentes na fila local e retorna à splash/início. Sem a integração configurada, o envio não é confirmado e isso é informado ao participante.

`Sobre o projeto` apresenta a história do projeto, o objetivo educacional e a imagem do robô físico (temporada 2025–2026), sem campos de edição nem armazenamento local.

## Limitações de hospedagem e navegador

- Reconhecimento de fala e síntese dependem de suporte/voz do navegador; reconhecimento também pode depender de rede e permissão de microfone.
- Sem uma integração externa configurada, nenhuma avaliação é enviada à planilha; registros locais pendentes permanecem na fila até que seja possível tentar o envio.
- O progresso e as configurações ficam no `localStorage` do navegador; apagar dados do site os remove.
- Antes de uma aplicação com estudantes, valide microfone, leitor de tela, consentimento e retenção de dados em dispositivos e navegadores reais.
