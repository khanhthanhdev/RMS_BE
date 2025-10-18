/**
 * Script to recalculate Opponent Win Percentage (OWP) for all existing team stats
 * This fixes the OWP values that were calculated with the incorrect formula
 */

import { PrismaClient } from '../generated/prisma';

const prisma = new PrismaClient();

async function recalculateOWP() {
  console.log('🔄 Starting OWP recalculation for all team stats...');

  try {
    // Get all team stats that have matches played
    const teamStats = await prisma.teamStats.findMany({
      where: {
        matchesPlayed: {
          gt: 0
        }
      },
      include: {
        team: true,
        tournament: true
      }
    });

    console.log(`📊 Found ${teamStats.length} team stats to recalculate`);

    let updatedCount = 0;

    for (const stat of teamStats) {
      try {
        // Get all matches for this team in this tournament
        const teamMatches = await prisma.match.findMany({
          where: {
            stage: {
              tournamentId: stat.tournamentId
            }
          },
          include: {
            alliances: {
              include: {
                teamAlliances: {
                  include: {
                    team: true
                  }
                }
              }
            }
          }
        });

        // Filter matches where this team participated
        const relevantMatches = teamMatches.filter(match =>
          match.alliances.some(alliance =>
            alliance.teamAlliances.some(ta => ta.teamId === stat.teamId)
          )
        );

        // Calculate OWP using the correct formula
        const opponentTeamIds = new Set<string>();

        // Collect all opponent team IDs
        for (const match of relevantMatches) {
          for (const alliance of match.alliances) {
            const teamAlliance = alliance.teamAlliances.find(ta => ta.teamId === stat.teamId);
            if (teamAlliance) {
              // This is our team's alliance, so opponents are in the other alliance
              const opponentAlliance = match.alliances.find(a => a.id !== alliance.id);
              if (opponentAlliance) {
                for (const opponentTA of opponentAlliance.teamAlliances) {
                  opponentTeamIds.add(opponentTA.teamId);
                }
              }
              break;
            }
          }
        }

        // Calculate average win percentage of opponents
        if (opponentTeamIds.size > 0) {
          const opponentStats = await prisma.teamStats.findMany({
            where: {
              teamId: { in: Array.from(opponentTeamIds) },
              tournamentId: stat.tournamentId
            }
          });

          let totalWinPercentage = 0;
          let validOpponents = 0;

          for (const oppStat of opponentStats) {
            if (oppStat.matchesPlayed > 0) {
              const winPercentage = oppStat.wins / oppStat.matchesPlayed;
              totalWinPercentage += winPercentage;
              validOpponents++;
            }
          }

          const correctOWP = validOpponents > 0 ? totalWinPercentage / validOpponents : 0;

          // Update the team stat with correct OWP
          await prisma.teamStats.update({
            where: { id: stat.id },
            data: {
              opponentWinPercentage: correctOWP,
              tiebreaker1: correctOWP // Also update tiebreaker1
            }
          });

          console.log(`✅ Updated ${stat.team.teamNumber} (${stat.team.name}): OWP ${stat.opponentWinPercentage.toFixed(3)} → ${correctOWP.toFixed(3)}`);
          updatedCount++;
        }

      } catch (error) {
        console.error(`❌ Error processing team ${stat.teamId}:`, error);
      }
    }

    console.log(`🎉 Successfully recalculated OWP for ${updatedCount} team stats`);

  } catch (error) {
    console.error('💥 Error during OWP recalculation:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
recalculateOWP()
  .then(() => {
    console.log('🏁 OWP recalculation completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 OWP recalculation failed:', error);
    process.exit(1);
  });
