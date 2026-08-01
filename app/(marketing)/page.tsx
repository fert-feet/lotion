import Footer from "./_components/footer";
import Heading from "./_components/heading";
import Heroes from "./_components/heroes";
import LandingText from "./_components/landingText";

const MarketingPage = () => {
  return (
    <div className="min-h-full flex flex-col">
      <div className="flex flex-col items-center gap-y-16 md:gap-y-24 flex-1 px-6 pb-20 pt-10">
        <Heading />
        <Heroes />
        <LandingText />
      </div>
      <Footer />
    </div>
  );
}

export default MarketingPage;
