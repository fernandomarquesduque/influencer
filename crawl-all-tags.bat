@echo off
chcp 65001 >nul
cd /d "%~dp0"
set LIMIT=%1
if "%LIMIT%"=="" set LIMIT=100
echo Iniciando fila de crawl: %LIMIT% perfis por tag.
echo Uso: crawl-all-tags.bat [limite]   ex: crawl-all-tags.bat 500
echo.

npx tsx src/cli/crawl-hashtag.ts --tag barbearia --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag barbershop --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag barba --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag cabelo --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag haircut --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag hairstyle --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag maquiagem --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag makeup --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag unhas --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag nails --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag skincare --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag estetica --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag sobrancelha --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag manicure --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag pedicure --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag fitness --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag academia --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag gym --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag treino --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag workout --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag musculacao --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag crossfit --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag corrida --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag running --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag yoga --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag pilates --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag ciclismo --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag bike --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag natacao --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag hiit --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag saudavel --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag healthy --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag moda --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag fashion --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag style --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag outfit --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag look --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag streetwear --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag lifestyle --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag viagem --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag travel --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag viajando --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag turismo --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag trip --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag praia --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag beach --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag hotel --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag trilha --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag hiking --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag natureza --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag nature --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag comida --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag food --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag foodie --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag receita --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag recipe --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag culinaria --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag restaurante --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag cafe --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag coffee --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag cerveja --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag beer --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag vinho --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag wine --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag hamburguer --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag burger --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag pizza --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag doces --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag tech --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag tecnologia --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag programacao --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag coding --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag dev --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag games --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag gaming --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag gamer --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag carro --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag carros --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag car --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag moto --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag maternidade --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag mae --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag mom --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag familia --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag family --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag bebe --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag baby --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag gravidez --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag pet --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag pets --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag cachorro --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag dog --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag gato --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag cat --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag decoracao --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag decor --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag casa --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag home --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag diy --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag empreendedorismo --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag negocios --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag business --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag marketing --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag musica --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag music --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag arte --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag fotografia --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag photography --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag futebol --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag football --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag basquete --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag skate --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag surf --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag jiujitsu --limit %LIMIT%
npx tsx src/cli/crawl-hashtag.ts --tag mma --limit %LIMIT%

echo.
echo Fila concluída.
pause
