FROM node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright
WORKDIR /workspace
COPY package.json package-lock.json ./
RUN npm ci && npx playwright install --with-deps chromium
COPY . .
EXPOSE 5174
CMD ["npm", "run", "dev", "--", "--port", "5174", "--strictPort"]
