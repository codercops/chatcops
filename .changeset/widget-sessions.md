---
"@chatcops/widget": minor
---

Session tokens. When the server has them on and a chat request gets a 401, the widget gets a token from `<apiUrl>/session`, keeps it in `localStorage`, and sends the request again with `Authorization: Bearer`. The saved token lets the server resume the conversation after a reload, and the widget moves to a new conversation id when the server gives one. Servers without session tokens see no change.
