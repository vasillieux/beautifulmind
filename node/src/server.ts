

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { DB } from './db';
import { SynapseSession } from './engine';

const fastify = Fastify({ logger: true });
const db = new DB('./beautifulmind.db');
const DECKS_DIR = './decks';

let session: SynapseSession | null = null;

// fastify.register(cors, {
//     origin: true,
//     methods: ['GET', 'POST', 'OPTIONS'],
//     allowedHeaders: ['Content-Type'],
// });

fastify.register(cors, { origin: '*' });

fastify.get('/theses', async (request, reply) => {
    return db.getTheses();
});

fastify.post('/session/start', async (request, reply) => {
    const { thesisId, isInfinite } = request.body as any;
    session = new SynapseSession(db, DECKS_DIR, thesisId, isInfinite);
    reply.send(session.getState());
});

fastify.post('/session/process', async (request, reply) => {
    if (session) {
        session.processInput((request.body as any).key);
        reply.send(session.getState());
    } else {
        reply.status(400).send({ error: 'no active session' });
    }
});

fastify.get('/correlations/:conceptId', async (request, reply) => {
    return db.getCorrelationsForConcept((request.params as any).conceptId);
});

fastify.post('/cards/add', async (request, reply) => {
    const newCard = db.addCard(request.body as any);
    reply.status(201).send(newCard);
});

const start = async () => {
    try {
        db.syncDecks(DECKS_DIR);
        await fastify.listen({ port: 3000 });
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

start();