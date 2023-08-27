import { getServerSession } from "next-auth/next"
import { authOptions } from "../auth/[...nextauth]"
import prisma from 'lib/prisma'

import type { NextApiRequest, NextApiResponse } from 'next'
import { Prisma } from "@prisma/client"
import { Event } from "cypress/types/jquery"

export type Event = Prisma.EventGetPayload<{
    include: { EventGroup: { include: { EventItem: true } }, UserOnEvent: { include: { user: true } } },
}>

export type UserOnEvent = Prisma.UserOnEventGetPayload<{
  include: { user: true },
}>

export type EventGroup = Prisma.EventGroupGetPayload<{
    include: { EventItem: true },
}>  


export type Data = {
  event?: Event;
  error?: string;
}

const eventHandler = async (
  req: NextApiRequest,
  res: NextApiResponse<Data>
) => {
  const session = await getServerSession(req, res, authOptions)
  if (!session) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const userEmail = session.user?.email || undefined;

  const currentUser = await prisma.user.findUnique({
    where: { email: userEmail },
  });

  const isAdmin = currentUser?.admin;

  const eventId = req.query.eventId as string;

  if (req.method === 'GET') {
    const event = await prisma.event.findUnique({
      where: { id: parseInt(eventId) },
      include: { EventGroup: { include: { EventItem: true }, orderBy: { start: "asc" } }, UserOnEvent: { include: { user: true } } },
    });


    if (!event) {
      res.status(404).json({ error: 'Event not found' });
      return;
    }

    const isInstructor = event?.UserOnEvent?.some((userOnEvent) => userOnEvent?.user?.email === userEmail && userOnEvent?.status === 'INSTRUCTOR');
    const isStudent = event?.UserOnEvent?.some((userOnEvent) => userOnEvent?.user?.email === userEmail && userOnEvent?.status === 'STUDENT');

    if (isStudent) {
      // remove all userOnEvent that are not the current user
      const userOnEvent = event.UserOnEvent.filter((userOnEvent) => userOnEvent?.user?.email === userEmail);
      event.UserOnEvent = userOnEvent;
    }

    if (!isAdmin && !isInstructor && !isStudent) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    res.status(200).json({ event });
  } else if (req.method === 'PUT') {
    const { name, enrol, content, start, end, summary, hidden } = req.body.event;
    const eventGroupData: EventGroup[] = req.body.event.EventGroup;
    const userOnEventData: UserOnEvent[] = req.body.event.UserOnEvent;

    console.log('eventGroupData', eventGroupData);
    console.log('userOnEventData', userOnEventData);
    console.log('req.body', req.body)

    if (!isAdmin) {
        res.status(401).json({ error: 'Unauthorized' });
        return; 
    }

    let updatedEvent = await prisma.event.update({
      where: { id: parseInt(eventId) },
      data: {
        name,
        summary,
        enrol,
        content,
        start,
        end,
        hidden,
        EventGroup: {
            deleteMany: {},
            createMany: {
                data: eventGroupData.map((group) => ({ ...group, eventId: undefined, id: undefined, EventItem: undefined })),
            }
        },
        UserOnEvent: {
            deleteMany: {},
            createMany: {
                data: userOnEventData.map((userOnEvent) => ({ ...userOnEvent, eventId: undefined, id: undefined, user: undefined }))
            }
        },
      },
      include: { EventGroup: { include: { EventItem: true } }, UserOnEvent: { include: { user: true } } },
    });
    for (let i = 0; i < eventGroupData.length; i++) {
        const group = eventGroupData[i];
        let newGroup = updatedEvent.EventGroup[i];
        if (group.EventItem.length > 0) {
            const createdItems = await prisma.eventItem.createMany({
                data: group.EventItem.map((item) => ({
                    ...item,
                    groupId: newGroup.id,
                })),
            });
        }
    }
    const event = await prisma.event.findUnique({
      where: { id: updatedEvent.id },
      include: { EventGroup: { include: { EventItem: true } }, UserOnEvent: { include: { user: true } } },
    });
    console.log('updated event', event);
    if (!event) {
      res.status(404).json({ error: 'Problem updating event, could not get from dbase' });
      return;
    }
    res.status(200).json({ event });
  } else if (req.method === 'DELETE') {
    if (!isAdmin) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    const deletedEvent = await prisma.event.delete({
      where: { id: parseInt(eventId) },
      include: { EventGroup: { include: { EventItem: true } }, UserOnEvent: { include: { user: true } } },
    });
    res.status(200).json({ event: deletedEvent });
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}

export default eventHandler