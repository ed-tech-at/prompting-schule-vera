# prompting.schule

hosted on [prompting.schule](https://prompting.schule) and [prompting.school](https://prompting.school/)

Software created by [Ed-Tech Research Community Graz](https://ed-tech.at)

Licence for this Software is [MIT](./LICENSE)

Licence for the Content is [CC BY 4.0 International](https://creativecommons.org/licenses/by/4.0/) Lehr- und Lerntechnologien, TU Graz

## Distribution & Self-Hosting
Self-hosting, modification, and redistribution of this project are permitted under the applicable licenses; however, when self-hosting, all TU Graz–specific references, including the TU Graz logo and institutional imprint, must be removed unless explicit permission has been granted. The original copyright notice must be retained: the software is licensed under the MIT License and requires inclusion of the original copyright and license text, and the content is licensed under CC BY 4.0 International and requires appropriate attribution to Lehr- und Lerntechnologien, TU Graz, including a link to the license and an indication of changes.


## Publication

*Prompting.School: A Design-Based Research Approach to Teaching AI Literacy through Guided Prompt Engineering Practice* 

Paper accepted at ICL2025, currently in revision.

# Local Development Startguide

## Setup Local PostgreSQL Database
Example Database Setup in with Docker Compose-File in [/docker/postgresql/docker-compose.yml](./docker/postgresql/)

Instructions:
1. Start PostgreSQL Server
   ```bash
   cd docker/postgresql-prompting-schule
   docker compose up -d
   cd ..
   cd ..
   ```
2. Test if .env is available, if not copy `.env-example`
   ```bash
   cd sveltekit
   [ -f .env ] && echo ".env available" || echo ".env missing, please execute: cp .env-example .env"
   cd ..
   ```
3. Update node modules and database schema with prisma
   ```bash
   cd sveltekit
   npm ci
   npx prisma db push
   cd ..
   ```
4. Insert seed data
   ```bash
   cd sveltekit
   npm run seed-prisma-db
   cd ..
   ```
5. Display Database, open http://localhost:5555
   ```bash
   cd sveltekit
   npx prisma studio
   cd ..
   ```
6. Optional: Delete all courses in Database (truncate), if seed is not possible
   ```bash
   cd sveltekit
   npm run truncate-prisma-db
   cd ..
   ```


   


